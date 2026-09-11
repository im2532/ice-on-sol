/**
 * Session calendar: flips `Commodity.status` Open<->Closed by trading-hours calendar, per
 * docs/CONTRACTS.md §1 `SessionKind` and docs/research/03 §3.3's staleness policy.
 *
 * - `CmeGlobex`: Sun 18:00 ET -> Fri 17:00 ET, with a daily 17:00-18:00 ET break.
 * - `IceUs`: ~04:00-14:00 ET, Mon-Fri.
 * - `Lme`: 01:00-19:00 London time, Mon-Fri.
 * - `Continuous` / `Slow`: never flips (always Open; Slow relies on a long max_age instead).
 *
 * Does NOT flip to/from `Halted` — that's an admin/risk action (reserve ratio, oracle
 * failure), not a calendar event; this cycle only ever sets Open or Closed, and if the
 * current status is Halted it leaves it alone (the guard/errors table's
 * "keeper: Open<->Closed and ->Halted; admin only Halted->Open" means the *keeper* may
 * still push Halted for a risk event elsewhere, but the session cycle itself never does).
 */
import { PegDeskClient } from "@icemarkets/sdk";
import { SessionKind, bySymbol } from "@icemarkets/registry";
import { listCommodities, updateCommodityStatus, type CommodityRow } from "../db";
import { sendWithPriority } from "../rpc";
import { childLogger } from "../logger";

const log = childLogger("session");

/** On-chain `Status` discriminants (CONTRACTS §1). */
const Status = { Open: 0, Closed: 1, Halted: 2 } as const;

/**
 * US market holidays for 2026 that CME Globex / ICE observe as a full close (or the
 * keeper should treat as Closed for majors). CHECK: this list is a best-effort compile
 * from standard federal/CME holiday rules (3rd Mon Jan, 3rd Mon Feb, Good Friday, last Mon
 * May, Jun 19, Jul 4 observed, 1st Mon Sep, 4th Thu Nov, Dec 25) and was not cross-checked
 * against CME's published 2026 holiday calendar in this sandbox (no network) — verify
 * before relying on it for a live deployment, and note some venues run abbreviated hours
 * (early close) on the day before/after some of these rather than a full closure.
 */
const US_HOLIDAYS_2026 = new Set([
  "2026-01-01", // New Year's Day
  "2026-01-19", // MLK Day
  "2026-02-16", // Presidents Day
  "2026-04-03", // Good Friday
  "2026-05-25", // Memorial Day
  "2026-06-19", // Juneteenth
  "2026-07-03", // Independence Day (observed, Jul 4 is a Saturday)
  "2026-09-07", // Labor Day
  "2026-11-26", // Thanksgiving
  "2026-12-25", // Christmas
]);

interface ZonedNow {
  /** 0=Sun..6=Sat */
  weekday: number;
  hour: number;
  minute: number;
  dateKey: string; // YYYY-MM-DD in that timezone
}

function zonedNow(date: Date, timeZone: string): ZonedNow {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = weekdayMap[get("weekday")] ?? 0;
  let hour = Number.parseInt(get("hour"), 10);
  if (hour === 24) hour = 0;
  const minute = Number.parseInt(get("minute"), 10);
  const dateKey = `${get("year")}-${get("month")}-${get("day")}`;
  return { weekday, hour, minute, dateKey };
}

function minutesOfDay(z: ZonedNow): number {
  return z.hour * 60 + z.minute;
}

/** CmeGlobex: open Sun 18:00 -> Fri 17:00 ET, minus a 17:00-18:00 ET break every day it's open. */
function isOpenCmeGlobex(date: Date): boolean {
  const z = zonedNow(date, "America/New_York");
  if (US_HOLIDAYS_2026.has(z.dateKey)) return false;
  const mins = minutesOfDay(z);
  const OPEN_MIN = 18 * 60; // 18:00
  const CLOSE_MIN = 17 * 60; // 17:00

  // Weekly close: from Fri 17:00 to Sun 18:00.
  if (z.weekday === 5 && mins >= CLOSE_MIN) return false; // Friday after 17:00
  if (z.weekday === 6) return false; // all day Saturday
  if (z.weekday === 0 && mins < OPEN_MIN) return false; // Sunday before 18:00

  // Daily break: 17:00-18:00 ET every other day of the week.
  if (mins >= CLOSE_MIN && mins < OPEN_MIN) return false;

  return true;
}

/** IceUs softs: ~04:00-14:00 ET, Mon-Fri. */
function isOpenIceUs(date: Date): boolean {
  const z = zonedNow(date, "America/New_York");
  if (US_HOLIDAYS_2026.has(z.dateKey)) return false;
  if (z.weekday === 0 || z.weekday === 6) return false;
  const mins = minutesOfDay(z);
  return mins >= 4 * 60 && mins < 14 * 60;
}

/** LME: 01:00-19:00 London time, Mon-Fri. */
function isOpenLme(date: Date): boolean {
  const z = zonedNow(date, "Europe/London");
  if (z.weekday === 0 || z.weekday === 6) return false;
  const mins = minutesOfDay(z);
  return mins >= 1 * 60 && mins < 19 * 60;
}

export function isSessionOpen(sessionKind: number, date: Date = new Date()): boolean {
  switch (sessionKind) {
    case SessionKind.Continuous:
      return true;
    case SessionKind.CmeGlobex:
      return isOpenCmeGlobex(date);
    case SessionKind.IceUs:
      return isOpenIceUs(date);
    case SessionKind.Lme:
      return isOpenLme(date);
    case SessionKind.Slow:
      return true; // "always open"; relies on a long max_age instead of a calendar
    default:
      log.warn({ sessionKind }, "isSessionOpen: unknown session kind, defaulting to open");
      return true;
  }
}

export async function runSessionCycle(pegDesk: PegDeskClient): Promise<void> {
  const commodities = await listCommodities();
  const now = new Date();

  for (const c of commodities) {
    if (c.status === Status.Halted) continue; // never auto-flip out of Halted

    const shouldBeOpen = isSessionOpen(c.session_kind, now);
    const desiredStatus = shouldBeOpen ? Status.Open : Status.Closed;
    if (c.status === desiredStatus) continue;

    const registryEntry = bySymbol(c.symbol);
    if (!registryEntry) {
      log.warn({ symbol: c.symbol }, "runSessionCycle: symbol not found in registry, skipping");
      continue;
    }

    log.info({ symbol: c.symbol, from: c.status, to: desiredStatus }, "flipping commodity status");
    try {
      const ix = await pegDesk.setStatusIx({ authority: pegDesk.program.provider.publicKey!, symbol: c.symbol, status: desiredStatus });
      await sendWithPriority([ix]);
      await updateCommodityStatus(c.symbol, desiredStatus);
    } catch (err) {
      log.error({ symbol: c.symbol, err: String(err) }, "failed to flip status");
    }
  }
}
