/**
 * OSRS gold (RSGP) pricing. STUB — per docs/research/03 §2: gray-market seller listings
 * (PlayerAuctions, Eldorado, G2G) are low-quality data and real-money trading breaks
 * Jagex's terms, so this is intentionally left unimplemented pending a decision on
 * whether to ship RSGP at all (it's Tier B / phase mvp in the registry today, but the
 * risk doc flags it as one of the weaker data sources in the whole catalog).
 *
 * TODO: implement once a sourcing decision is made — options in order of preference:
 *   1. A licensed/ToS-compliant marketplace API, if one exists.
 *   2. Scraping G2G/Eldorado listing pages for the $/M-gp sell price with a median across
 *      several sellers (mirrors the CS2 median approach in cs2.ts).
 *   3. Drop RSGP from the launch list entirely (see docs/research/03 §5, which already
 *      recommends dropping the drug coins on similar "poor data quality" grounds).
 */
import { childLogger } from "../logger";

const log = childLogger("sources/osrs");

export async function fetchOsrsGoldPrice(): Promise<number | null> {
  log.warn("fetchOsrsGoldPrice: not implemented — see TODO in sources/osrs.ts");
  return null;
}
