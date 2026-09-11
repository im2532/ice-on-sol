/**
 * Collector Crypt (collectorcrypt.com) — a Solana marketplace of vaulted physical cards
 * and watches, tokenized as NFTs (Metaplex Core) redeemable for the physical item. Used
 * here as an additional price source: a third leg for `watch_*_median3` jobs (alongside
 * WatchCharts + the Chrono24 stub, see `sources/watches.ts`) and a third leg for
 * `tcg_*_market` jobs (alongside `sources/tcg.ts`'s pokemontcg.io market price), combined
 * via `median3` (`sources/median.ts`) in `cycles/oracle.ts`.
 *
 * Returns the median of the last N sales in USD for a given reference (a watch reference
 * number, or a card's set+number key). SOL-denominated sales are converted at the current
 * SOL/USD price from Pyth Hermes (same `hermesUrl` the oracle cycle already uses).
 *
 * // CHECK: none of this has been exercised against a live response (no network in this
 * sandbox). Two paths, in preference order:
 *   1. Helius DAS `getAssetsByGroup` (primary) — verifiable on-chain: list the Core NFTs
 *      in Collector Crypt's vault collection (`COLLECTORCRYPT_COLLECTION`), match the one(s)
 *      whose name/attributes contain the reference, then pull each matched mint's recent
 *      transaction history via Helius's Enhanced Transactions API filtered to
 *      `type=NFT_SALE` to get real sale prices. CHECK: the exact DAS response shape
 *      (`result.items[].content.metadata.{name,attributes}`), whether Collector Crypt's
 *      vault items are Metaplex Core assets or legacy Token Metadata NFTs (changes the DAS
 *      `interface` filter), and the Enhanced Transactions `NFT_SALE` event shape
 *      (`events.nft.amount`, native lamports) — all transcribed from Helius's public docs
 *      and the task brief, not verified live.
 *   2. A REST API at `COLLECTORCRYPT_API_URL` (optional; e.g. a hypothetical
 *      `https://api.collectorcrypt.com`), used as a fallback if the marketplace publishes
 *      one — CHECK: no public API docs were reachable from this sandbox, so the endpoint
 *      shape below is a guess at a conventional "recent sales for an item" shape.
 * If neither path is configured or both fail, this returns null and the caller's
 * `median3` just proceeds with whichever other sources responded.
 */
import { loadConfig } from "../config";
import { childLogger } from "../logger";

const log = childLogger("sources/collectorcrypt");

const SALES_WINDOW = 5; // median of the last N sales

interface SaleUsd {
  priceUsd: number;
  ts: number;
}

/**
 * symbol -> { searchTerm, reference }. `searchTerm` matches DAS asset name/attributes;
 * `reference` is the shorter key used for the REST fallback. Covers both `watches` (same
 * reference numbers as `sources/watches.ts` WATCH_REFERENCE) and `trading_cards` symbols
 * that plausibly have a Collector Crypt vaulted equivalent (single graded cards — box
 * products like the ETBs are typically not individually vaulted/tokenized).
 * CHECK: confirm against Collector Crypt's actual catalogue.
 */
export const COLLECTOR_CRYPT_ITEM: Record<string, { searchTerm: string; reference: string }> = {
  SUBMARINER: { searchTerm: "Rolex Submariner 126610LN", reference: "126610LN" },
  DAYTONA: { searchTerm: "Rolex Daytona 126500LN", reference: "126500LN" },
  GMTMASTER: { searchTerm: "Rolex GMT-Master II 126710BLNR", reference: "126710BLNR" },
  DATEJUST: { searchTerm: "Rolex Datejust 41 126334", reference: "126334" },
  ROYALOAK: { searchTerm: "Audemars Piguet Royal Oak 15510ST", reference: "15510ST" },
  NAUTILUS: { searchTerm: "Patek Philippe Nautilus 5811", reference: "5811-1G" },
  SPEEDMASTER: { searchTerm: "Omega Speedmaster Moonwatch", reference: "310.30.42.50.01.001" },
  SANTOS: { searchTerm: "Cartier Santos WSSA0018", reference: "WSSA0018" },
  GSHOCK: { searchTerm: "Casio G-Shock DW-5600E", reference: "DW-5600E-1" },
  TISSOTPRX: { searchTerm: "Tissot PRX Powermatic 80", reference: "T137.407.11.041.00" },
  UMBREONEX: { searchTerm: "Umbreon ex 161/131", reference: "sv08.5-161" },
  MOONBREON: { searchTerm: "Umbreon VMAX Alt Art", reference: "swsh07-alt-umbreon" },
  ZARDEX199: { searchTerm: "Charizard ex 199/165", reference: "sv04.5-199" },
  ZARDEX223: { searchTerm: "Charizard ex 223/197", reference: "sv04.5-223" },
  ZARDBASE: { searchTerm: "Base Set Charizard", reference: "base1-4" },
  PIKAEX238: { searchTerm: "Pikachu ex 238/191", reference: "sv08-238" },
  MEWEX232: { searchTerm: "Mew ex 232/091", reference: "sv08.5-232" },
  TRMEWTWO: { searchTerm: "Team Rocket's Mewtwo ex", reference: "sv09.5-tr-mewtwo" },
};

// ---- SOL/USD (Pyth Hermes), cached briefly so a burst of relay calls doesn't hammer Hermes ----
const SOL_USD_FEED_ID = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56c"; // CHECK: Pyth Crypto.SOL/USD feed id
let cachedSolUsd: { price: number; fetchedAt: number } | null = null;
const SOL_USD_CACHE_MS = 30_000;

async function fetchSolUsd(hermesUrl: string): Promise<number | null> {
  if (cachedSolUsd && Date.now() - cachedSolUsd.fetchedAt < SOL_USD_CACHE_MS) return cachedSolUsd.price;
  try {
    const url = `${hermesUrl}/v2/updates/price/latest?ids[]=${SOL_USD_FEED_ID}&parsed=true`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const body = (await res.json()) as { parsed?: { price: { price: string; expo: number } }[] };
    const p = body.parsed?.[0]?.price;
    if (!p) return null;
    const price = Number(p.price) * 10 ** p.expo;
    if (!(price > 0)) return null;
    cachedSolUsd = { price, fetchedAt: Date.now() };
    return price;
  } catch (err) {
    log.warn({ err: String(err) }, "hermes SOL/USD fetch failed");
    return null;
  }
}

// ---- primary: Helius DAS getAssetsByGroup + Enhanced Transactions ----

interface DasAsset {
  id: string; // mint address
  content?: { metadata?: { name?: string; attributes?: { trait_type?: string; value?: string }[] } };
}

/** Finds Collector Crypt vault asset mint addresses matching `searchTerm` (name/attribute substring, case-insensitive). */
async function findMatchingAssets(heliusRpcUrl: string, collection: string, searchTerm: string): Promise<string[]> {
  // CHECK vs Helius DAS API: exact request/response shape for getAssetsByGroup, and
  // whether collection membership needs `groupKey: "collection"` (Token Metadata) or a
  // Core-specific filter (`interface: "MplCoreAsset"` + a separate collection field).
  const body = {
    jsonrpc: "2.0",
    id: "icemarkets-collectorcrypt",
    method: "getAssetsByGroup",
    params: { groupKey: "collection", groupValue: collection, page: 1, limit: 1000 },
  };
  const res = await fetch(heliusRpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { result?: { items?: DasAsset[] } };
  const items = json.result?.items ?? [];
  const needle = searchTerm.toLowerCase();
  return items
    .filter((a) => {
      const name = a.content?.metadata?.name?.toLowerCase() ?? "";
      const attrHit = (a.content?.metadata?.attributes ?? []).some((attr) => (attr.value ?? "").toLowerCase().includes(needle));
      return name.includes(needle) || attrHit;
    })
    .map((a) => a.id)
    .slice(0, 10); // cap: at most 10 candidate mints, we only need a handful of recent sales
}

interface HeliusNftSaleEvent {
  timestamp?: number;
  events?: { nft?: { amount?: number; buyer?: string; seller?: string } };
}

/** Recent NFT_SALE events for one mint via Helius's Enhanced Transactions API (amount is native lamports). */
async function fetchRecentSalesForMint(heliusApiKey: string, mint: string): Promise<{ lamports: number; ts: number }[]> {
  try {
    // CHECK vs Helius Enhanced Transactions API: exact path is `/v0/addresses/{address}/transactions`
    // with `type=NFT_SALE`; response is an array of parsed transactions, each carrying
    // `events.nft.amount` for a marketplace sale. Not verified live.
    const url = `https://api.helius.xyz/v0/addresses/${mint}/transactions?api-key=${heliusApiKey}&type=NFT_SALE&limit=5`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const txs = (await res.json()) as HeliusNftSaleEvent[];
    return txs
      .map((tx) => ({ lamports: tx.events?.nft?.amount ?? 0, ts: tx.timestamp ?? Math.floor(Date.now() / 1000) }))
      .filter((s) => s.lamports > 0);
  } catch (err) {
    log.warn({ mint, err: String(err) }, "helius enhanced-tx NFT_SALE fetch failed");
    return [];
  }
}

async function fetchSalesViaHeliusDas(symbol: string): Promise<SaleUsd[] | null> {
  const cfg = loadConfig();
  const item = COLLECTOR_CRYPT_ITEM[symbol];
  if (!item || !cfg.collectorCryptCollection || !cfg.heliusApiKey) return null;

  const heliusRpcUrl = cfg.rpcUrl; // the configured Helius RPC endpoint doubles as the DAS endpoint
  try {
    const mints = await findMatchingAssets(heliusRpcUrl, cfg.collectorCryptCollection, item.searchTerm);
    if (mints.length === 0) return null;

    const solUsd = await fetchSolUsd(cfg.hermesUrl);
    if (!solUsd) return null;

    const allSales = (await Promise.all(mints.map((m) => fetchRecentSalesForMint(cfg.heliusApiKey!, m)))).flat();
    if (allSales.length === 0) return null;

    return allSales
      .sort((a, b) => b.ts - a.ts)
      .slice(0, SALES_WINDOW)
      .map((s) => ({ priceUsd: (s.lamports / 1e9) * solUsd, ts: s.ts }));
  } catch (err) {
    log.warn({ symbol, err: String(err) }, "collectorcrypt helius-das path failed");
    return null;
  }
}

// ---- fallback: Collector Crypt's own REST API, if configured ----

async function fetchSalesViaRestApi(symbol: string): Promise<SaleUsd[] | null> {
  const cfg = loadConfig();
  const item = COLLECTOR_CRYPT_ITEM[symbol];
  if (!item || !cfg.collectorCryptApiUrl) return null;
  try {
    // CHECK: no public API docs were reachable from this sandbox — guessed conventional shape.
    const url = `${cfg.collectorCryptApiUrl.replace(/\/$/, "")}/v1/items/${encodeURIComponent(item.reference)}/sales?limit=${SALES_WINDOW}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const body = (await res.json()) as { sales?: { priceUsd?: number; priceSol?: number; ts?: number; blockTime?: number }[] };
    const sales = body.sales ?? [];
    if (sales.length === 0) return null;

    let solUsd: number | null = null;
    const out: SaleUsd[] = [];
    for (const s of sales) {
      const ts = s.ts ?? s.blockTime ?? Math.floor(Date.now() / 1000);
      if (typeof s.priceUsd === "number" && s.priceUsd > 0) {
        out.push({ priceUsd: s.priceUsd, ts });
      } else if (typeof s.priceSol === "number" && s.priceSol > 0) {
        solUsd = solUsd ?? (await fetchSolUsd(cfg.hermesUrl));
        if (solUsd) out.push({ priceUsd: s.priceSol * solUsd, ts });
      }
    }
    return out.length > 0 ? out : null;
  } catch (err) {
    log.warn({ symbol, err: String(err) }, "collectorcrypt REST sales fetch failed");
    return null;
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Median of the last few Collector Crypt sales (USD) for a watch or trading-card symbol, or null if unavailable. */
export async function fetchCollectorCryptPrice(symbol: string): Promise<number | null> {
  if (!COLLECTOR_CRYPT_ITEM[symbol]) return null;
  const sales = (await fetchSalesViaHeliusDas(symbol)) ?? (await fetchSalesViaRestApi(symbol));
  if (!sales || sales.length === 0) return null;
  return median(sales.map((s) => s.priceUsd));
}
