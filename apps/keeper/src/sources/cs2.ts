/**
 * CS2 skin pricing: median across Pricempire, CSFloat and Skinport, per
 * docs/research/03 §2 ("use the median across 3+ markets and a fixed wear/float grade").
 * Feeds `KeeperSigned` updates for MVP until the Switchboard job (see
 * switchboard/jobs/cs2-median.json) is live and the commodity's `oracle_kind` flips to
 * Switchboard.
 *
 * // CHECK: none of these vendor APIs could be reached from this sandbox (no network) —
 * endpoint paths/response shapes below are transcribed from docs/research/03's citations
 * (Pricempire API docs, CSFloat market API, Skinport public API) and were not exercised
 * against a live response. Confirm before depending on this in production; each fetcher
 * fails soft (returns null) so a single vendor outage doesn't block the median.
 */
import { loadConfig } from "../config";
import { childLogger } from "../logger";

const log = childLogger("sources/cs2");

/** Registry symbol -> the market-name search term each vendor expects, fixed at a wear grade (per research doc guidance). */
const MARKET_NAME: Record<string, string> = {
  AKREDLINE: "AK-47 | Redline (Field-Tested)",
  AWPASIIMOV: "AWP | Asiimov (Field-Tested)",
  DLORE: "AWP | Dragon Lore (Field-Tested)",
  HOWL: "M4A4 | Howl (Field-Tested)",
  KARAMBIT: "★ Karambit | Doppler (Factory New)",
  BFLYFADE: "★ Butterfly Knife | Fade (Factory New)",
  DEAGLEBLAZE: "Desert Eagle | Blaze (Factory New)",
  GLOCKFADE: "Glock-18 | Fade (Factory New)",
  PRINTSTREAM: "M4A1-S | Printstream (Field-Tested)",
  VICEGLOVES: "★ Sport Gloves | Vice (Field-Tested)",
  BRAVOCASE: "Operation Bravo Case",
  VULCAN: "AK-47 | Vulcan (Field-Tested)",
};

async function fetchPricempire(symbol: string, apiKey: string | undefined): Promise<number | null> {
  if (!apiKey) return null;
  const marketName = MARKET_NAME[symbol];
  if (!marketName) return null;
  try {
    // CHECK vs Pricempire API: exact path/query param names for a single-item price lookup.
    const url = `https://api.pricempire.com/v3/items/prices?market_hash_name=${encodeURIComponent(marketName)}&currency=USD`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) return null;
    const body = (await res.json()) as { price?: number; median?: number };
    return body.median ?? body.price ?? null;
  } catch (err) {
    log.warn({ symbol, err: String(err) }, "pricempire fetch failed");
    return null;
  }
}

async function fetchCsfloat(symbol: string, apiKey: string | undefined): Promise<number | null> {
  if (!apiKey) return null;
  const marketName = MARKET_NAME[symbol];
  if (!marketName) return null;
  try {
    // CHECK vs CSFloat API: listings endpoint + how to derive a representative price (e.g. lowest-price active listing, or a dedicated pricing endpoint).
    const url = `https://csfloat.com/api/v1/listings?market_hash_name=${encodeURIComponent(marketName)}&sort_by=lowest_price&limit=5`;
    const res = await fetch(url, { headers: { Authorization: apiKey } });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { price: number }[] };
    const prices = (body.data ?? []).map((d) => d.price / 100); // CSFloat prices are cents
    if (prices.length === 0) return null;
    return median(prices);
  } catch (err) {
    log.warn({ symbol, err: String(err) }, "csfloat fetch failed");
    return null;
  }
}

async function fetchSkinport(symbol: string): Promise<number | null> {
  const marketName = MARKET_NAME[symbol];
  if (!marketName) return null;
  try {
    // Skinport's public items endpoint doesn't require a key.
    const url = `https://api.skinport.com/v1/items?app_id=730&currency=USD`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const body = (await res.json()) as { market_hash_name: string; suggested_price?: number; min_price?: number }[];
    const item = body.find((i) => i.market_hash_name === marketName);
    return item?.suggested_price ?? item?.min_price ?? null;
  } catch (err) {
    log.warn({ symbol, err: String(err) }, "skinport fetch failed");
    return null;
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Returns the median of whichever of the 3 vendors respond, or null if none do. */
export async function fetchCs2Price(symbol: string): Promise<{ price: number; sourcesUsed: number } | null> {
  const cfg = loadConfig();
  const [pricempire, csfloat, skinport] = await Promise.all([
    fetchPricempire(symbol, cfg.pricempireApiKey),
    fetchCsfloat(symbol, cfg.csfloatApiKey),
    fetchSkinport(symbol),
  ]);
  const prices = [pricempire, csfloat, skinport].filter((p): p is number => p !== null && p > 0);
  if (prices.length === 0) return null;
  return { price: median(prices), sourcesUsed: prices.length };
}
