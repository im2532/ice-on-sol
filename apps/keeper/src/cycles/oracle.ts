/**
 * Oracle cycle: pushes Pyth Hermes updates for PythPull commodities into per-commodity
 * persistent update accounts, posts KeeperSigned prices (from `src/sources/*`) for
 * manual/slow coins, and RELAYS Switchboard-kind commodities (see `relaySwitchboardPrices`).
 * Per docs/CONTRACTS.md §5 and docs/research/03 §3.3.
 *
 * // CHECK vs SDK @pythnetwork/hermes-client ^2.0.0, @pythnetwork/pyth-solana-receiver ^0.10.0
 * The exact method names (`getLatestPriceUpdates`, `buildPostPriceUpdateInstructions`,
 * `buildPostPriceUpdateAtomicInstructions`) and their argument/return shapes are
 * transcribed from the task brief; this package could not be installed in this sandbox
 * (no network), so none of this has compiled against the real types. Confined to this
 * file (and the small oracle-only calls inside it) so a rename is a one-line fix.
 *
 * Approach for "persistent update accounts" (rather than atomic/ephemeral, per-tx updates):
 *   1. Post each Hermes update with `closeUpdateAccounts: false`, so the resulting
 *      `PriceUpdateV2` account stays around across pushes (Pyth's receiver program allows
 *      re-posting into the same derived account when using the non-atomic builder).
 *   2. The FIRST time a commodity gets a Pyth update account (or if its derived address
 *      ever changes — e.g. a receiver program upgrade), call `peg_desk.set_feed_account`
 *      once to point `Commodity.feed_account` at it. Every subsequent push just refreshes
 *      that same account in place, so `set_feed_account` does NOT need to run every cycle
 *      — only track "did the address change since last time" and call it then.
 *   3. Batch feed ids at most 5 per Hermes request / receiver transaction (task spec cap;
 *      also keeps the tx under Solana's transaction size limit alongside our own
 *      program's ComputeBudget + accounts).
 */
import { HermesClient } from "@pythnetwork/hermes-client";
import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";
import { Connection, PublicKey } from "@solana/web3.js";
import { PegDeskClient, scaleQuote } from "@icemarkets/sdk";
import { OracleKind, COMMODITIES, bySymbol } from "@icemarkets/registry";
import { loadConfig } from "../config";
import { getConnection, getKeeperKeypair, sendWithPriority } from "../rpc";
import { childLogger } from "../logger";
import { insertPrice, getLatestPrice, listCommodities, updateCommodityFeedAccount, type CommodityRow } from "../db";
import { readManualPrices } from "../sources/manualPrices";
import { fetchCs2Price } from "../sources/cs2";
import { fetchTcgPrice } from "../sources/tcg";
import { fetchOsrsGoldPrice } from "../sources/osrs";
import { fetchWatchChartsPrice, fetchChrono24Price } from "../sources/watches";
import { fetchCollectorCryptPrice } from "../sources/collectorcrypt";
import { median3, type SourceReading } from "../sources/median";

const log = childLogger("oracle");

const FEED_BATCH_SIZE = 5;
const DEVIATION_TRIGGER_BPS = 10; // 0.1%

/** Tracks the last known feed_account per symbol so we only call set_feed_account on change. */
const lastKnownFeedAccount = new Map<string, string>();

export async function runOracleCycle(pegDesk: PegDeskClient): Promise<void> {
  const cfg = loadConfig();
  const connection = getConnection();
  const keeper = getKeeperKeypair();

  const dbCommodities = await listCommodities();
  const byOracleKind = groupByOracleKind(dbCommodities);

  if (byOracleKind.pythPull.length > 0) {
    await runPythPullBatch(pegDesk, connection, keeper.publicKey, byOracleKind.pythPull, cfg.hermesUrl, cfg.pythApiKey);
  }
  if (byOracleKind.keeperSigned.length > 0) {
    await runKeeperSignedBatch(pegDesk, byOracleKind.keeperSigned);
  }
  if (byOracleKind.switchboard.length > 0) {
    await relaySwitchboardPrices(pegDesk, byOracleKind.switchboard);
  }
}

function groupByOracleKind(rows: CommodityRow[]) {
  const pythPull: CommodityRow[] = [];
  const keeperSigned: CommodityRow[] = [];
  const switchboard: CommodityRow[] = [];
  for (const r of rows) {
    if (r.oracle_kind === OracleKind.PythPull) pythPull.push(r);
    else if (r.oracle_kind === OracleKind.KeeperSigned) keeperSigned.push(r);
    else if (r.oracle_kind === OracleKind.Switchboard) switchboard.push(r);
  }
  return { pythPull, keeperSigned, switchboard };
}

/** Relay cadence per commodity (seconds); the program's `KeeperPrice.min_interval` still applies on-chain. */
const SWITCHBOARD_RELAY_MIN_INTERVAL_SEC = 300;
/** Confidence posted with a relayed median: 1% of price for ≥ 2 sources, 2% for a single source. */
const relayConfBps = (sourcesUsed: number): bigint => (sourcesUsed >= 2 ? 100n : 200n);
/** Confidence posted when bootstrapping from the manual-prices.json seed (wider than any live-source case). */
const MANUAL_FALLBACK_CONF_BPS = 500n; // 5%

/**
 * Switchboard relay (stand-in). For `OracleKind.Switchboard` commodities the program currently reads a
 * KeeperPrice-shaped account at `commodity.feed_account` = PDA["kp", commodity] (peg_desk oracle.rs
 * `read_switchboard` TODO), and `keeper_update_price` accepts Switchboard kind. So the keeper fetches the
 * SAME sources the Switchboard job would (src/switchboard/jobs/*.json → src/sources/*) and posts the
 * result with `keeper_update_price` — bounded on-chain by `max_move_bps` / `min_interval`.
 *
 * Source by category: cs2_skins → median(Pricempire, CSFloat, Skinport); trading_cards →
 * median3(pokemontcg.io market, Collector Crypt sales); watches → median3(WatchCharts,
 * Chrono24 [scrape-disabled stub], Collector Crypt sales), falling back to the
 * data/manual-prices.json seed (wide conf) when fewer than 2 live sources respond;
 * game_gold → sources/osrs.ts (stub, returns null). Futures that need a licensed vendor feed
 * (RB/HO/LBR/… — jobs/futures-vendor.json) have no keeper source yet and are skipped with a warning.
 *
 * TODO switchboard-on-demand: once `switchboard-on-demand` replaces the stand-in in oracle.rs, delete
 * this relay and instead crank the on-demand pull feed (`@switchboard-xyz/on-demand` PullFeed
 * `fetchUpdateIx`) in the consuming transaction, pointing `feed_account` at the PullFeed account.
 */
async function relaySwitchboardPrices(pegDesk: PegDeskClient, rows: CommodityRow[]): Promise<void> {
  const keeper = getKeeperKeypair();
  // Stamp relays with the CHAIN clock, not the keeper's: peg_desk rejects publish_time more than
  // MAX_FUTURE_SKEW_SECS (10 s) ahead of Clock::unix_timestamp, and a local/loaded validator's clock can
  // lag wall time by hours (localnet drifted 10,000 s in one session). Falls back to wall time.
  const nowSec = await chainNowSec(getConnection());
  for (const row of rows) {
    const entry = bySymbol(row.symbol);
    if (!entry) continue;
    const last = await getLatestPrice(row.symbol);
    if (last && nowSec - last.ts < SWITCHBOARD_RELAY_MIN_INTERVAL_SEC) continue;

    let reading: { price: number; sourcesUsed: number; source: string } | null = null;
    let usedManualFallback = false;
    try {
      switch (entry.category) {
        case "cs2_skins": {
          const r = await fetchCs2Price(row.symbol);
          reading = r ? { ...r, source: `cs2-median3:${entry.oracle.switchboardJob ?? row.symbol}` } : null;
          break;
        }
        case "trading_cards": {
          // tcg_* jobs: pokemontcg.io market price + Collector Crypt recent-sales median as a third leg.
          const [pokemontcg, collectorcrypt] = await Promise.all([fetchTcgPrice(row.symbol), fetchCollectorCryptPrice(row.symbol)]);
          const readings: (SourceReading | null)[] = [
            pokemontcg ? { price: pokemontcg, source: "pokemontcg" } : null,
            collectorcrypt ? { price: collectorcrypt, source: "collectorcrypt" } : null,
          ];
          const m = median3(readings);
          // A single responding source (pokemontcg alone, the pre-Collector-Crypt behavior) is
          // still usable for cards — unlike watches there's no manual-price fallback for this
          // category, so fall back to the lone reading rather than dropping the update entirely.
          reading = m
            ? { price: m.price, sourcesUsed: m.sourcesUsed, source: `median3:${m.sources.join("+")}` }
            : pokemontcg
              ? { price: pokemontcg, sourcesUsed: 1, source: "pokemontcg" }
              : null;
          break;
        }
        case "watches": {
          // watch_* jobs: WatchCharts + Chrono24 (scrape-disabled stub, always null today) +
          // Collector Crypt recent-sales median.
          const [watchcharts, chrono24, collectorcrypt] = await Promise.all([
            fetchWatchChartsPrice(row.symbol),
            fetchChrono24Price(row.symbol),
            fetchCollectorCryptPrice(row.symbol),
          ]);
          const readings: (SourceReading | null)[] = [
            watchcharts ? { price: watchcharts, source: "watchcharts" } : null,
            chrono24 ? { price: chrono24, source: "chrono24" } : null,
            collectorcrypt ? { price: collectorcrypt, source: "collectorcrypt" } : null,
          ];
          const m = median3(readings);
          reading = m ? { price: m.price, sourcesUsed: m.sourcesUsed, source: `median3:${m.sources.join("+")}` } : null;
          break;
        }
        case "game_gold": {
          const p = await fetchOsrsGoldPrice();
          reading = p ? { price: p, sourcesUsed: 1, source: "osrs" } : null;
          break;
        }
        default:
          // Futures without a Pyth feed (RB/HO/LBR/…): no live keeper source until a licensed
          // vendor feed exists — fall through to the manual-prices.json seed below.
          reading = null;
          break;
      }
    } catch (err) {
      log.warn({ symbol: row.symbol, err: String(err) }, "switchboard relay source fetch failed");
      continue;
    }

    // Live sources returned no value (or, for multi-source categories, fewer than 2): bootstrap
    // from the manual-prices.json seed ("seed-estimate" entries), marked with a wide confidence
    // band so downstream consumers can tell it's not a real median. Applies to every
    // Switchboard-relayed coin that has a seed entry; cards/CS2 with exactly one live source
    // keep the live reading.
    const needsSeed = !reading || (reading.sourcesUsed < 2 && entry.category === "watches");
    if (needsSeed) {
      try {
        const manualEntries = await readManualPrices();
        const seed = manualEntries.find((e) => e.symbol === row.symbol);
        if (seed) {
          reading = { price: seed.price, sourcesUsed: 1, source: `manual-seed:${seed.source}` };
          usedManualFallback = true;
        }
      } catch (err) {
        log.warn({ symbol: row.symbol, err: String(err) }, "manual-prices.json fallback read failed");
      }
    }

    if (!reading || !(reading.price > 0)) {
      log.warn({ symbol: row.symbol }, "switchboard relay: no source responded");
      continue;
    }

    const price1e8 = BigInt(Math.round(reading.price * 1e8));
    const conf = usedManualFallback ? (price1e8 * MANUAL_FALLBACK_CONF_BPS) / 10_000n : (price1e8 * relayConfBps(reading.sourcesUsed)) / 10_000n;
    try {
      const ix = await pegDesk.keeperUpdatePriceIx({
        keeper: keeper.publicKey,
        symbol: row.symbol,
        commodity: new PublicKey(row.commodity_pubkey),
        price: price1e8,
        conf,
        publishTime: BigInt(nowSec),
        sourceHash: hashSource(reading.source),
      });
      await sendWithPriority([ix]);
      await insertPrice({ commodity: row.symbol, ts: nowSec, price: price1e8.toString(), conf: conf.toString(), source: "switchboard" });
      log.info({ symbol: row.symbol, price: reading.price, sources: reading.sourcesUsed }, "relayed Switchboard-kind price");
    } catch (err) {
      // MoveTooLarge / TooSoon are expected occasionally (bounded feed); the next cycle retries.
      log.error({ symbol: row.symbol, err: String(err) }, "switchboard relay keeper_update_price failed");
    }
  }
}

async function runPythPullBatch(
  pegDesk: PegDeskClient,
  connection: ReturnType<typeof getConnection>,
  keeperPubkey: PublicKey,
  rows: CommodityRow[],
  hermesUrl: string,
  pythApiKey: string | undefined,
): Promise<void> {
  if (!pythApiKey) log.warn("PYTH_API_KEY not set: Hermes price updates return 401 without it (required since 2026-08-26)");
  const hermes = new HermesClient(hermesUrl, pythApiKey ? { headers: { Authorization: `Bearer ${pythApiKey}` } } : {});

  // Map db row -> registry feed id (registry is the source of truth for feed ids; db just tracks on-chain state).
  const withFeedIds = rows
    .map((r) => ({ row: r, entry: bySymbol(r.symbol) }))
    .filter((x): x is { row: CommodityRow; entry: NonNullable<ReturnType<typeof bySymbol>> } => !!x.entry?.oracle.feedId);

  for (let i = 0; i < withFeedIds.length; i += FEED_BATCH_SIZE) {
    const batch = withFeedIds.slice(i, i + FEED_BATCH_SIZE);
    const feedIds = batch.map((x) => `0x${x.entry.oracle.feedId}`);

    let updates: Awaited<ReturnType<HermesClient["getLatestPriceUpdates"]>>;
    try {
      // CHECK vs SDK: getLatestPriceUpdates(feedIds, { encoding: "base64" }) return shape —
      // assumed to carry `.binary.data` (array of hex/base64 VAA-wrapped update blobs) and
      // `.parsed` (per-feed price/conf/publish_time) alongside it.
      updates = await hermes.getLatestPriceUpdates(feedIds, { encoding: "base64" } as any);
    } catch (err) {
      log.error({ err: String(err), feedIds }, "hermes.getLatestPriceUpdates failed");
      continue;
    }

    // Decide, per commodity in this batch, whether the reading is worth posting (deviation
    // >= 0.1% or age >= configured interval) before spending a transaction on it.
    const parsed = (updates as any).parsed as { id: string; price: { price: string; conf: string; expo: number; publish_time: number } }[];
    // Hermes returns raw (price, expo) in the feed's quote unit; the program (and the DB) use USD at 1e8.
    // Same conversion as pricing.rs `scale_quote` (EUR-quoted feeds need the fx feed — none in the MVP registry).
    const toUsd1e8 = (entry: { oracle: { quote?: "USD" | "USc" | "EUR" } }, raw: string, expo: number): bigint =>
      scaleQuote(BigInt(raw), expo, entry.oracle.quote === "USc" ? 1 : 0);
    const dueForPost: typeof batch = [];
    for (const item of batch) {
      const feedIdHex = item.entry.oracle.feedId!;
      const p = parsed.find((x) => x.id.replace(/^0x/, "") === feedIdHex);
      if (!p) continue;
      if (item.entry.oracle.quote === "EUR") continue; // CHECK: EUR feeds need fx conversion (none in MVP)
      const shouldPost = await isDueForPost(item.row.symbol, toUsd1e8(item.entry, p.price.price, p.price.expo), Number(p.price.publish_time));
      if (shouldPost) dueForPost.push(item);
    }
    if (dueForPost.length === 0) continue;

    const receiver = new PythSolanaReceiver({ connection, wallet: makeNodeWallet(keeperPubkey) as any });
    try {
      // CHECK vs SDK: buildPostPriceUpdateInstructions(priceUpdateData, { closeUpdateAccounts: false })
      // is expected to return { postInstructions, priceFeedIdToPriceUpdateAccount } or similar —
      // adjust the destructuring below to match the installed version's actual return shape.
      const built = await (receiver as any).buildPostPriceUpdateInstructions((updates as any).binary.data, {
        closeUpdateAccounts: false,
      });
      const ixs = built.postInstructions ?? built.instructions ?? [];
      await sendWithPriority(ixs);

      const priceUpdateAccounts: Record<string, PublicKey> = built.priceFeedIdToPriceUpdateAccount ?? {};
      for (const item of dueForPost) {
        const feedIdHex = item.entry.oracle.feedId!;
        const p = parsed.find((x) => x.id.replace(/^0x/, "") === feedIdHex)!;
        await insertPrice({
          commodity: item.row.symbol, // prices.commodity references commodities.symbol
          ts: Number(p.price.publish_time),
          price: toUsd1e8(item.entry, p.price.price, p.price.expo).toString(),
          conf: toUsd1e8(item.entry, p.price.conf, p.price.expo).toString(),
          source: "pyth",
        });

        const updateAccount = priceUpdateAccounts[feedIdHex];
        if (updateAccount) {
          const addr = updateAccount.toBase58();
          if (lastKnownFeedAccount.get(item.row.symbol) !== addr) {
            log.info({ symbol: item.row.symbol, updateAccount: addr }, "feed_account changed, calling set_feed_account");
            const setFeedIx = await pegDesk.setFeedAccountIx({
              authority: keeperPubkey,
              symbol: item.row.symbol,
              feedAccount: updateAccount,
              fxFeedAccount: PublicKey.default, // CHECK: wire the real FX account for EUR-quoted feeds (e.g. TTF gas)
            });
            await sendWithPriority([setFeedIx]);
            lastKnownFeedAccount.set(item.row.symbol, addr);
            await updateCommodityFeedAccount(item.row.symbol, addr);
          }
        }
      }
    } catch (err) {
      log.error({ err: String(err), symbols: dueForPost.map((x) => x.row.symbol) }, "failed to post Pyth update batch");
    }
  }
}

async function isDueForPost(symbol: string, price: bigint, publishTime: number): Promise<boolean> {
  const last = await getLatestPrice(symbol);
  if (!last) return true;
  const ageSec = Math.abs(publishTime - last.ts);
  const cfg = loadConfig();
  if (ageSec >= cfg.oraclePushIntervalSec) return true;
  const lastPrice = BigInt(last.price);
  if (lastPrice === 0n) return true;
  const diff = price > lastPrice ? price - lastPrice : lastPrice - price;
  const deviationBps = (diff * 10_000n) / lastPrice;
  return deviationBps >= BigInt(DEVIATION_TRIGGER_BPS);
}

async function runKeeperSignedBatch(pegDesk: PegDeskClient, rows: CommodityRow[]): Promise<void> {
  const manual = await readManualPrices();
  const keeper = getKeeperKeypair();

  for (const row of rows) {
    const entry = manual.find((m) => m.symbol === row.symbol);
    if (!entry) {
      log.warn({ symbol: row.symbol }, "no manual price entry found for KeeperSigned commodity");
      continue;
    }
    const registryEntry = bySymbol(row.symbol);
    const cadenceSec = registryEntry?.oracle.cadenceSec ?? 7 * 86400;
    const publishTimeSec = Math.floor(new Date(entry.updatedAt).getTime() / 1000);

    const last = await getLatestPrice(row.symbol);
    if (last && publishTimeSec - last.ts < Math.min(cadenceSec, 3600)) {
      continue; // min_interval guard, mirrored client-side so we don't waste a tx that would just revert on-chain
    }

    const price1e8 = BigInt(Math.round(entry.price * 1e8));
    const sourceHash = hashSource(entry.source);

    try {
      const ix = await pegDesk.keeperUpdatePriceIx({
        keeper: keeper.publicKey,
        symbol: row.symbol,
        commodity: new PublicKey(row.commodity_pubkey),
        price: price1e8,
        conf: price1e8 / 1000n, // 0.1% conf band placeholder for manual sources; CHECK against desired risk params
        publishTime: BigInt(publishTimeSec),
        sourceHash,
      });
      await sendWithPriority([ix]);
      await insertPrice({
        commodity: row.symbol,
        ts: publishTimeSec,
        price: price1e8.toString(),
        conf: (price1e8 / 1000n).toString(),
        source: "keeper",
      });
      log.info({ symbol: row.symbol, price: entry.price }, "posted KeeperSigned price");
    } catch (err) {
      log.error({ symbol: row.symbol, err: String(err) }, "keeper_update_price failed");
    }
  }
}

function hashSource(source: string): Buffer {
  // Lightweight, dependency-free source-hash: not cryptographically load-bearing (the
  // program just stores it as a provenance note per CONTRACTS §1), so a simple digest is
  // fine here rather than pulling in the SDK's keccak256 for a non-verification field.
  const buf = Buffer.alloc(32);
  const bytes = Buffer.from(source, "utf8");
  for (let i = 0; i < bytes.length; i++) buf[i % 32] ^= bytes[i];
  return buf;
}

/** Minimal Anchor-Wallet-shaped object so PythSolanaReceiver can build (not sign+send) instructions; actual signing/sending goes through rpc.ts's keeper keypair. */
function makeNodeWallet(publicKey: PublicKey) {
  return {
    publicKey,
    signTransaction: async (tx: unknown) => tx,
    signAllTransactions: async (txs: unknown[]) => txs,
  };
}

/** On-chain unix time (block time of the latest confirmed slot); wall clock if the RPC cannot provide it. */
export async function chainNowSec(connection: Connection): Promise<number> {
  try {
    const slot = await connection.getSlot("confirmed");
    const t = await connection.getBlockTime(slot);
    if (t) return t;
  } catch {
    /* fall through */
  }
  return Math.floor(Date.now() / 1000);
}
