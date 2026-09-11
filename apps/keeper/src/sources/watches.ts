/**
 * Watch pricing (secondary-market, unworn/full-set) for the `watches` category
 * (packages/registry/src/commodities.ts) — SUBMARINER, DAYTONA, GMTMASTER, DATEJUST,
 * ROYALOAK, NAUTILUS, SPEEDMSTR, SANTOS, GSHOCK, TISSOTPRX. Feeds the `watch_*_median3`
 * Switchboard-kind relay in `cycles/oracle.ts` (see `switchboard/jobs/watch-median.json`),
 * combined there with Collector Crypt (`sources/collectorcrypt.ts`) via `median3`.
 *
 * Two of three sources live here:
 *  1. WatchCharts — a real market-data vendor for watches (watchcharts.com) with a paid
 *     API keyed by `WATCHCHARTS_API_KEY`. // CHECK: endpoint path/response shape below are
 *     transcribed from the task brief and WatchCharts' public marketing pages describing a
 *     "reference number → market price" lookup; this sandbox has no network, so none of
 *     this has been exercised against a live response. Confirm against their actual API
 *     docs (requires a partner/API agreement) before depending on it.
 *  2. Chrono24 — the largest watch marketplace, but it has **no public API** (its data is
 *     only reachable by scraping listing pages, which its ToS prohibits and which is
 *     brittle/slow to maintain). `fetchChrono24Price` is therefore an intentional
 *     scrape-disabled stub that always returns `null`, exactly like `sources/osrs.ts`'s
 *     RSGP stub — kept as a named source so the relay's 3-source shape (WatchCharts +
 *     Chrono24 + Collector Crypt) is ready to light up the moment a compliant sourcing
 *     path exists (a licensed data partner, or a ToS-compliant scrape service).
 */
import { loadConfig } from "../config";
import { childLogger } from "../logger";

const log = childLogger("sources/watches");

/**
 * Registry symbol -> the reference number each vendor indexes by, and a free-text search
 * term as a fallback for vendors that search by name rather than reference number.
 * CHECK: confirm exact reference numbers against the registry's `name` field
 * (packages/registry/src/commodities.ts) and each vendor's own catalogue.
 */
interface WatchRef {
  reference: string; // manufacturer reference number, e.g. "126610LN"
  searchTerm: string; // "<brand> <model> <reference>"
}

export const WATCH_REFERENCE: Record<string, WatchRef> = {
  SUBMARINER: { reference: "126610LN", searchTerm: "Rolex Submariner Date 126610LN" },
  DAYTONA: { reference: "126500LN", searchTerm: "Rolex Cosmograph Daytona 126500LN" },
  GMTMASTER: { reference: "126710BLNR", searchTerm: "Rolex GMT-Master II 126710BLNR" },
  DATEJUST: { reference: "126334", searchTerm: "Rolex Datejust 41 126334" },
  ROYALOAK: { reference: "15510ST.OO.1320ST.01", searchTerm: "Audemars Piguet Royal Oak 15510ST" },
  NAUTILUS: { reference: "5811/1G-001", searchTerm: "Patek Philippe Nautilus 5811/1G" },
  SPEEDMSTR: { reference: "310.30.42.50.01.001", searchTerm: "Omega Speedmaster Moonwatch Professional" },
  SANTOS: { reference: "WSSA0018", searchTerm: "Cartier Santos Large WSSA0018" },
  GSHOCK: { reference: "DW-5600E-1", searchTerm: "Casio G-Shock DW-5600E" },
  TISSOTPRX: { reference: "T137.407.11.041.00", searchTerm: "Tissot PRX Powermatic 80" },
};

/** WatchCharts market price for a reference number, in USD. */
export async function fetchWatchChartsPrice(symbol: string): Promise<number | null> {
  const cfg = loadConfig();
  if (!cfg.watchChartsApiKey) return null;
  const ref = WATCH_REFERENCE[symbol];
  if (!ref) {
    log.warn({ symbol }, "no WatchCharts reference mapping for symbol");
    return null;
  }
  try {
    // CHECK vs WatchCharts API: exact path/query param names for a single-reference market
    // price lookup, and whether the market price is a flat `price` or a `{ average, min,
    // max }`-shaped object. Assumed here to mirror common vendor-price-lookup shapes.
    const url = `https://api.watchcharts.com/v3/watch/market-price?reference_number=${encodeURIComponent(ref.reference)}&currency=USD`;
    const res = await fetch(url, { headers: { "X-Api-Key": cfg.watchChartsApiKey } });
    if (!res.ok) return null;
    const body = (await res.json()) as { market_price?: number; price?: { average?: number } };
    const price = body.market_price ?? body.price?.average ?? null;
    return typeof price === "number" && price > 0 ? price : null;
  } catch (err) {
    log.warn({ symbol, err: String(err) }, "watchcharts fetch failed");
    return null;
  }
}

/**
 * Chrono24 has no public API — scraping is disabled here (ToS + brittleness), so this
 * always returns null. Left in place (rather than removed) so the relay's source list
 * documents the intended 3-source design and the call site doesn't need special-casing.
 */
export async function fetchChrono24Price(symbol: string): Promise<number | null> {
  void symbol;
  log.warn({ symbol }, "fetchChrono24Price: scrape-disabled stub (no public Chrono24 API) — see header comment");
  return null;
}
