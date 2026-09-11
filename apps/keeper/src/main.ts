/**
 * Keeper entrypoint: runs every cycle on its own interval (+jitter), exposes a /healthz
 * HTTP endpoint, and shuts down gracefully on SIGINT/SIGTERM. See README.md for the full
 * cycle table and run instructions.
 */
import http from "node:http";
import { loadConfig } from "./config";
import { childLogger, logger } from "./logger";
import { getPool } from "./db";
import { getPegDeskClient, getProgram } from "./programs";
import { runOracleCycle } from "./cycles/oracle";
import { runSessionCycle } from "./cycles/session";
import { runFeesCycle } from "./cycles/fees";
import { runPayoutsCycle } from "./cycles/payouts";
import { runMigrateCycle } from "./cycles/migrate";
import { runBuybackCycle } from "./cycles/buyback";

const log = childLogger("main");

interface ScheduledCycle {
  name: string;
  intervalSec: number;
  run: () => Promise<void>;
}

let healthy = true;
const lastRunAt: Record<string, number> = {};
const lastError: Record<string, string | null> = {};
const timers: NodeJS.Timeout[] = [];
let shuttingDown = false;

async function main(): Promise<void> {
  const cfg = loadConfig();
  log.info({ cluster: cfg.cluster, rpcUrl: cfg.rpcUrl }, "starting ICEmarkets keeper");

  // Sanity-check DB connectivity before scheduling anything.
  await getPool().query("select 1");

  // IDLs are read from target/idl/*.json (or IDL_DIR) — fail fast at boot if `anchor build` hasn't run.
  const pegDesk = getPegDeskClient();
  getProgram("fee_router");
  getProgram("distributor");
  getProgram("buyback");

  const cycles: ScheduledCycle[] = [
    { name: "oracle", intervalSec: cfg.oraclePushIntervalSec, run: () => runOracleCycle(pegDesk) },
    { name: "session", intervalSec: cfg.sessionCycleIntervalSec, run: () => runSessionCycle(pegDesk) },
    { name: "fees", intervalSec: cfg.feeCycleIntervalSec, run: () => runFeesCycle() },
    { name: "payouts", intervalSec: cfg.feeCycleIntervalSec, run: () => runPayoutsCycle() },
    { name: "migrate", intervalSec: cfg.migrateCycleIntervalSec, run: () => runMigrateCycle() },
    { name: "buyback", intervalSec: cfg.buybackCycleIntervalSec, run: () => runBuybackCycle() },
  ];

  for (const cycle of cycles) scheduleCycle(cycle);

  startHealthzServer(cfg.healthzPort);

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

function scheduleCycle(cycle: ScheduledCycle): void {
  const runOnce = async () => {
    if (shuttingDown) return;
    const cycleLog = childLogger(cycle.name);
    const start = Date.now();
    try {
      await cycle.run();
      lastError[cycle.name] = null;
      cycleLog.debug({ ms: Date.now() - start }, "cycle completed");
    } catch (err) {
      lastError[cycle.name] = String(err);
      cycleLog.error({ err: String(err), ms: Date.now() - start }, "cycle failed");
    }
    lastRunAt[cycle.name] = Date.now();
    if (!shuttingDown) {
      const jitterMs = Math.floor(Math.random() * 1000);
      timers.push(setTimeout(runOnce, cycle.intervalSec * 1000 + jitterMs));
    }
  };

  // Stagger initial kickoff so every cycle doesn't fire in the same tick on boot.
  const initialDelayMs = Math.floor(Math.random() * 2000);
  timers.push(setTimeout(runOnce, initialDelayMs));
}

function startHealthzServer(port: number): void {
  const server = http.createServer((req, res) => {
    if (req.url === "/healthz") {
      const body = JSON.stringify({ healthy, lastRunAt, lastError }, null, 2);
      res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
      res.end(body);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(port, () => log.info({ port }, "healthz server listening"));
}

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, "shutting down");
  for (const t of timers) clearTimeout(t);
  getPool()
    .end()
    .catch(() => {})
    .finally(() => process.exit(0));
  // Force-exit if pool.end() hangs.
  setTimeout(() => process.exit(0), 5000).unref();
}

main().catch((err) => {
  logger.fatal({ err: String(err) }, "keeper failed to start");
  process.exit(1);
});
