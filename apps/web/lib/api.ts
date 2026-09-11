/**
 * Typed fetchers against the indexer API (apps/indexer), matching docs/CONTRACTS.md §5 tables.
 * When NEXT_PUBLIC_USE_MOCK=1 (default until the indexer is deployed) every fetcher resolves from
 * lib/mock.ts instead of hitting the network, so the app renders fully standalone.
 */
import {
  MOCK_COMMODITY_QUOTES,
  MOCK_MARKETS,
  MOCK_STATS,
  mockCandles,
  mockLeaderboard,
  mockPriceHistory,
  mockTrades,
  mockWalletRewards,
} from "./mock";
import type {
  Candle,
  ClaimableLeaf,
  CommodityQuote,
  GlobalStats,
  LeaderboardRow,
  Market,
  PricePoint,
  Trade,
  WalletRewards,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
export const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK !== "0";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

/** Like getJson but maps the indexer's 404 `{ error: "not found" }` to null. */
async function getJsonOrNull<T>(path: string): Promise<T | null> {
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

function delay<T>(value: T, ms = 120): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export interface MarketsQuery {
  q?: string;
  tab?: "all" | "new" | "migrated";
  sort?: "mcap_desc" | "mcap_asc" | "vol_desc" | "new";
  page?: number;
  pageSize?: number;
}

export async function fetchMarkets(query: MarketsQuery = {}): Promise<{ markets: Market[]; total: number }> {
  if (USE_MOCK) {
    let list = MOCK_MARKETS.slice();
    if (query.q) {
      const q = query.q.toLowerCase();
      list = list.filter(
        (m) =>
          m.ticker.toLowerCase().includes(q) ||
          m.name.toLowerCase().includes(q) ||
          m.commoditySymbol.toLowerCase().includes(q) ||
          m.commodityName.toLowerCase().includes(q)
      );
    }
    if (query.tab === "new") list = list.filter((m) => Date.now() - new Date(m.createdAt).getTime() < 86_400_000 * 3);
    if (query.tab === "migrated") list = list.filter((m) => m.migrated);
    switch (query.sort) {
      case "mcap_asc":
        list.sort((a, b) => a.fdvUsd - b.fdvUsd);
        break;
      case "vol_desc":
        list.sort((a, b) => b.volume24hUsd - a.volume24hUsd);
        break;
      case "new":
        list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        break;
      default:
        list.sort((a, b) => b.fdvUsd - a.fdvUsd);
    }
    const total = list.length;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 8;
    const start = (page - 1) * pageSize;
    return delay({ markets: list.slice(start, start + pageSize), total });
  }
  const params = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => v != null && params.set(k, String(v)));
  return getJson(`/markets?${params.toString()}`);
}

export async function fetchNewLaunches(limit = 5): Promise<Market[]> {
  if (USE_MOCK) {
    return delay(
      MOCK_MARKETS.slice()
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, limit)
    );
  }
  return getJson(`/markets?sort=new&pageSize=${limit}`);
}

export async function fetchMarket(mint: string): Promise<Market | null> {
  if (USE_MOCK) return delay(MOCK_MARKETS.find((m) => m.mint === mint) ?? null);
  return getJsonOrNull(`/markets/${mint}`);
}

export async function fetchCommodities(): Promise<CommodityQuote[]> {
  if (USE_MOCK) return delay(MOCK_COMMODITY_QUOTES);
  return getJson(`/commodities`);
}

export async function fetchCommodity(symbol: string): Promise<CommodityQuote | null> {
  if (USE_MOCK) return delay(MOCK_COMMODITY_QUOTES.find((c) => c.symbol === symbol) ?? null);
  return getJsonOrNull(`/commodities/${symbol}`);
}

export async function fetchCommodityPriceHistory(
  symbol: string,
  range: "24h" | "7d" | "30d"
): Promise<PricePoint[]> {
  const q = await fetchCommodity(symbol);
  const base = q?.priceUsd ?? 100;
  const points = range === "24h" ? 24 : range === "7d" ? 24 * 7 : 24 * 30;
  if (USE_MOCK) return delay(mockPriceHistory(base, points));
  return getJson(`/commodities/${symbol}/price-history?range=${range}`);
}

export async function fetchTrades(mint: string): Promise<Trade[]> {
  if (USE_MOCK) {
    const market = MOCK_MARKETS.find((m) => m.mint === mint);
    return delay(market ? mockTrades(market) : []);
  }
  return getJson(`/trades/${mint}`);
}

export async function fetchCandles(mint: string): Promise<Candle[]> {
  if (USE_MOCK) {
    const market = MOCK_MARKETS.find((m) => m.mint === mint);
    return delay(mockCandles(market?.priceUsd ?? 0.00001));
  }
  return getJson(`/candles/${mint}`);
}

export async function fetchLeaderboard(): Promise<LeaderboardRow[]> {
  if (USE_MOCK) return delay(mockLeaderboard());
  return getJson(`/rewards/leaderboard`);
}

export async function fetchWalletRewards(wallet: string): Promise<WalletRewards> {
  if (USE_MOCK) return delay(mockWalletRewards(wallet));
  return getJson(`/rewards/${wallet}`);
}

/** Unclaimed Merkle leaves (with proofs) for the distributor `claim` instruction. */
export async function fetchClaimableLeaves(wallet: string): Promise<ClaimableLeaf[]> {
  if (USE_MOCK) return delay([]);
  return getJson(`/rewards/${wallet}/claims`);
}

export async function fetchStats(): Promise<GlobalStats> {
  if (USE_MOCK) return delay(MOCK_STATS);
  return getJson(`/stats`);
}
