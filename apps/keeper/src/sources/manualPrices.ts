/**
 * Reads `data/manual-prices.json` — the KeeperSigned source for the fast-food/water/car
 * coins until a licensed feed exists (per docs/research/03 §2: "for manual coins, use a
 * KeeperSignedPrice account"). Fast-food prices are from The Economist's Big Mac index /
 * a menu-price check (docs/research/01); H2O and LAMBO are placeholder estimates flagged
 * "TODO-verify" in the source field — replace with a real NQH2O index read and a current
 * Temerario MSRP before relying on them for real trading.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

export interface ManualPriceEntry {
  symbol: string;
  price: number;
  source: string;
  updatedAt: string; // ISO 8601
}

const DEFAULT_PATH = path.join(__dirname, "..", "..", "data", "manual-prices.json");

let cache: { entries: ManualPriceEntry[]; loadedAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

export async function readManualPrices(filePath: string = DEFAULT_PATH): Promise<ManualPriceEntry[]> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.entries;
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as ManualPriceEntry[];
  validate(parsed);
  cache = { entries: parsed, loadedAt: Date.now() };
  return parsed;
}

function validate(entries: ManualPriceEntry[]): void {
  for (const e of entries) {
    if (typeof e.symbol !== "string" || !e.symbol) throw new Error(`manual-prices.json: entry missing symbol: ${JSON.stringify(e)}`);
    if (typeof e.price !== "number" || !(e.price > 0)) throw new Error(`manual-prices.json: ${e.symbol} has invalid price`);
    if (Number.isNaN(Date.parse(e.updatedAt))) throw new Error(`manual-prices.json: ${e.symbol} has invalid updatedAt`);
  }
}
