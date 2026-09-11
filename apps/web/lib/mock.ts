/**
 * Realistic mock data so the app renders fully with NEXT_PUBLIC_USE_MOCK=1 and no backend.
 * Numbers are flavored from docs/research/01 (647 markets, 94 commodities, $9.6M 24h vol, $14.2M TVL,
 * $79.2K paid to holders / 4K wallets, 4.78M burned) scaled down for a smaller, still-plausible universe.
 * Generated once at module load with a seeded PRNG so SSR/CSR renders match (no hydration drift).
 */
import { COMMODITIES, CATEGORY_LABEL, INDEX_COINS, type Commodity } from "@icemarkets/registry";
import type {
  Candle,
  CommodityQuote,
  GlobalStats,
  LeaderboardRow,
  Market,
  MarketStatus,
  PricePoint,
  Trade,
  WalletRewards,
} from "./types";

// ---- seeded PRNG (mulberry32) so mock data is stable across renders ----
function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260911);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
const rand = (min: number, max: number) => min + rng() * (max - min);

// ---- base commodity reference prices (USD), roughly current per docs research ----
const BASE_PRICE: Record<string, number> = {
  GLD: 4403.7, SLV: 65.0, XPT: 1798.85, XPD: 1323.75, HG: 6.54, ALI: 3419.0,
  CL: 100.15, BZ: 105.05, USO: 154.24, NG: 2.81, RB: 3.15, HO: 4.81,
  LBR: 570.0, ZW: 7.96, ZC: 5.3, ZS: 13.03, ZM: 352.75, ZL: 0.6999, ZR: 16.14, ZO: 3.78,
  SB: 0.19, KC: 3.85, CC: 8900.0, CT: 0.68, OJ: 3.1, DC: 18.4,
  LE: 1.92, GF: 2.75, HE: 0.86,
  BURGER: 5.99, NUGGETS: 5.49, BIGBURGER: 6.79, CHIXSAND: 6.19, TACO: 2.29, BURRITO: 8.49,
  LATTE: 5.65, PIZZA: 14.99, DBLBURGER: 3.49, BACONBRGR: 6.29, SPICYCHIX: 5.79, MEDCOFFEE: 2.79, FRIES: 3.29,
  RSGP: 0.42,
  H2O: 1150.0, LAMBO: 289000.0,
  SUBMARINER: 13900.0, DAYTONA: 28500.0, GMTMASTER: 17200.0, DATEJUST: 10400.0, ROYALOAK: 52000.0,
  NAUTILUS: 128000.0, SPEEDMSTR: 6900.0, SANTOS: 7300.0, GSHOCK: 60.0, TISSOTPRX: 675.0,
};
const CS2_BASE = 65;
const CARD_BASE = 145;

function priceFor(c: Commodity): number {
  if (BASE_PRICE[c.symbol] != null) return BASE_PRICE[c.symbol];
  if (c.category === "cs2_skins") return CS2_BASE * rand(0.3, 20);
  if (c.category === "trading_cards") return CARD_BASE * rand(0.2, 8);
  return rand(1, 100);
}

const CHANGE_RANGE: [number, number] = [-4, 4];

export const MOCK_COMMODITY_QUOTES: CommodityQuote[] = COMMODITIES.map((c) => {
  const priceUsd = priceFor(c);
  const status: MarketStatus = rng() > 0.94 ? "halted" : rng() > 0.9 ? "closed" : "open";
  const supplyCap = c.params.supplyCapUsd;
  const supplyOutstanding = supplyCap * rand(0.1, 0.85);
  return {
    symbol: c.symbol,
    name: c.name,
    displayName: c.displayName,
    category: c.category,
    emoji: c.emoji,
    unit: c.unit,
    unitShort: c.unitShort,
    priceUsd,
    change24h: rand(...CHANGE_RANGE),
    marketsCount: Math.floor(rand(1, 40)),
    status,
    lastPublishedAgoSec: status === "halted" ? Math.floor(rand(3600 * 6, 3600 * 80)) : Math.floor(rand(2, 90)),
    supplyCap,
    supplyOutstanding,
    reserveRatioBps: Math.floor(rand(9700, 11200)),
    mint: fakeMint(c.symbol),
  };
});

/** Index coins: priced as the weighted sum of their legs, like peg_desk `read_composite`. */
export const MOCK_INDEX_QUOTES: CommodityQuote[] = INDEX_COINS.map((c) => {
  const legs = c.oracle.legs ?? [];
  const priceUsd = legs.reduce((acc, l) => acc + ((MOCK_COMMODITY_QUOTES.find((q) => q.symbol === l.symbol)?.priceUsd ?? 0) * l.weightBps) / 10_000, 0);
  return {
    symbol: c.symbol,
    name: c.name,
    displayName: c.displayName,
    category: c.category,
    emoji: c.emoji,
    unit: c.unit,
    unitShort: c.unitShort,
    priceUsd,
    change24h: rand(...CHANGE_RANGE),
    marketsCount: 0,
    status: "open" as MarketStatus,
    lastPublishedAgoSec: Math.floor(rand(2, 90)),
    supplyCap: c.params.supplyCapUsd,
    supplyOutstanding: 0,
    reserveRatioBps: 10_000,
    mint: fakeMint(c.symbol),
  };
});

function fakeMint(seedStr: string): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let x = 0;
  for (let i = 0; i < seedStr.length; i++) x = (x * 31 + seedStr.charCodeAt(i)) >>> 0;
  const local = mulberry32(x || 1);
  let out = "";
  for (let i = 0; i < 44; i++) out += alphabet[Math.floor(local() * alphabet.length)];
  return out;
}

const MEME_NAMES: [string, string][] = [
  ["Copper Inu", "COPPERINU"], ["Cookware Corp", "COOKWARE"], ["Milkers", "MILKERS"], ["WEN Lambo", "WEN"],
  ["FARTCOIN Classic", "FART"], ["PartyHat", "PHAT"], ["Gas Money", "GAS"], ["Goodman", "GOODMAN"],
  ["Plumber Bros", "PLUMBER"], ["Baby Copper", "BABYCOPPER"], ["Doge Standard", "DOG"], ["KetKat", "KETKAT"],
  ["Wheat King", "WHEATKING"], ["Oil Baron", "OILBARON"], ["Cocoa Puff", "COCOAPUFF"], ["Sugar Rush", "SUGARRUSH"],
  ["Burger Time", "BURGRTIME"], ["Skin Flip", "SKINFLIP"], ["Card Shark", "CARDSHARK"], ["Aqua Man", "AQUAMAN"],
  ["Bull Run", "BULLRUN"], ["Moon Farmer", "MOONFARM"], ["Palladium Pete", "PALPETE"], ["Cotton Eye", "COTTONEYE"],
  ["Rice Baron", "RICEBARON"], ["Hog Wild", "HOGWILD"], ["Cattle Drive", "CATTLDRV"], ["Aluminum Ape", "ALUAPE"],
  ["Diesel Dan", "DIESELDAN"], ["Wagmi Wheat", "WAGMIWHT"],
];

const AVATARS = ["🐶", "🦍", "🐸", "🐹", "🦊", "🐼", "🐨", "🦁", "🐯", "🐵", "🐰", "🐻", "🐔", "🐷", "🦄"];

function makeMarket(i: number): Market {
  const c = pick(COMMODITIES.filter((x) => x.phase === "mvp"));
  const q = MOCK_COMMODITY_QUOTES.find((x) => x.symbol === c.symbol)!;
  const [name, ticker] = MEME_NAMES[i % MEME_NAMES.length];
  const migrated = rng() > 0.92;
  const fdv = migrated ? rand(20000, 900000) : rand(3000, 40000);
  const curveProgressPct = migrated ? 100 : clampPct(((fdv - 5000) / (35000 - 5000)) * 100);
  const change24h = rand(-45, 90);
  const feeBps = pick([100, 200, 300]);
  return {
    mint: fakeMint(`${ticker}-${i}`),
    ticker: `${ticker}${i > MEME_NAMES.length - 1 ? Math.floor(i / MEME_NAMES.length) : ""}`,
    name,
    image: AVATARS[i % AVATARS.length],
    commoditySymbol: c.symbol,
    commodityEmoji: c.emoji,
    commodityName: c.displayName ?? c.name,
    pairedWith: c.symbol,
    fdvUsd: fdv,
    priceQuote: fdv / 1_000_000_000 / q.priceUsd,
    priceUsd: fdv / 1_000_000_000,
    change24h,
    volume24hUsd: rand(500, 850000),
    curveProgressPct,
    migrated,
    createdAt: new Date(Date.now() - rand(60_000, 86_400_000 * 40)).toISOString(),
    feeBps,
    creator: fakeMint(`creator-${i}`),
    dbcPool: fakeMint(`dbc-${i}`),
    dammPool: migrated ? fakeMint(`damm-${i}`) : undefined,
    holderEarningsCoin: rand(0, 500),
  };
}
function clampPct(n: number) {
  return Math.max(0, Math.min(100, n));
}

export const MOCK_MARKETS: Market[] = Array.from({ length: 96 }, (_, i) => makeMarket(i));

export const MOCK_STATS: GlobalStats = {
  marketsCount: 647,
  commoditiesCount: COMMODITIES.length, // 93 (incl. watches) + 3 index coins listed separately
  volume24hUsd: 9_600_000,
  valueLockedUsd: 14_200_000,
  paidToHoldersUsd: 79_200,
  paidToHolders24hUsd: 62_300,
  holderWallets: 4000,
  iceBoughtBackUsd: 39_000,
  iceBurned: 4_780_000,
  iceBurnedPct: 0.48,
  iceMcapUsd: 10_092_638.39,
  icePriceGld: 0.0001527,
};

export function mockPriceHistory(basePrice: number, points: number, volPct = 1.5): PricePoint[] {
  const now = Math.floor(Date.now() / 1000);
  const stepSec = 3600;
  let p = basePrice * rand(0.9, 1.1);
  const out: PricePoint[] = [];
  const local = mulberry32(Math.floor(basePrice * 1000) || 7);
  for (let i = points; i >= 0; i--) {
    const drift = (local() - 0.5) * (volPct / 100) * p;
    p = Math.max(0.0001, p + drift);
    out.push({ ts: now - i * stepSec, price: p });
  }
  // anchor last point to the true current price
  out[out.length - 1] = { ts: now, price: basePrice };
  return out;
}

export function mockCandles(basePrice: number, points = 180): Candle[] {
  const now = Math.floor(Date.now() / 1000);
  const stepSec = 300;
  const local = mulberry32(Math.floor(basePrice * 777) || 11);
  let last = basePrice * rand(0.7, 1.3);
  const out: Candle[] = [];
  for (let i = points; i >= 0; i--) {
    const o = last;
    const vol = o * 0.02;
    const c = Math.max(0.0000001, o + (local() - 0.5) * vol);
    const h = Math.max(o, c) + local() * vol * 0.5;
    const l = Math.min(o, c) - local() * vol * 0.5;
    out.push({ ts: now - i * stepSec, o, h, l: Math.max(0.0000001, l), c, v: local() * 50000 });
    last = c;
  }
  return out;
}

export function mockTrades(market: Market, n = 40): Trade[] {
  const local = mulberry32(Math.floor(market.priceUsd * 999999) || 3);
  const now = Math.floor(Date.now() / 1000);
  return Array.from({ length: n }, (_, i) => {
    const side: "buy" | "sell" = local() > 0.5 ? "buy" : "sell";
    const baseAmount = local() * 500000;
    const priceUsd = market.priceUsd * (1 + (local() - 0.5) * 0.02);
    return {
      sig: fakeMint(`trade-${market.mint}-${i}`),
      ts: now - i * Math.floor(local() * 400 + 20),
      side,
      baseAmount,
      quoteAmount: baseAmount * market.priceQuote,
      priceQuote: market.priceQuote,
      priceUsd,
      trader: fakeMint(`trader-${i}-${market.mint}`),
    };
  });
}

export function mockLeaderboard(): LeaderboardRow[] {
  return MOCK_MARKETS.slice()
    .sort((a, b) => b.holderEarningsCoin - a.holderEarningsCoin)
    .slice(0, 60)
    .map((m, i) => ({
      rank: i + 1,
      mint: m.mint,
      ticker: m.ticker,
      name: m.name,
      image: m.image,
      pairedWith: m.commoditySymbol,
      pairedEmoji: m.commodityEmoji,
      feeAmountCoin: m.holderEarningsCoin * rand(5, 20),
      feeCoinSymbol: m.commoditySymbol,
      holderShareUsd:
        m.holderEarningsCoin *
        (MOCK_COMMODITY_QUOTES.find((q) => q.symbol === m.commoditySymbol)?.priceUsd ?? 1) *
        rand(1, 3),
    }));
}

export function mockWalletRewards(wallet: string): WalletRewards {
  const local = mulberry32(hashStr(wallet));
  const coins = COMMODITIES.filter((c) => c.phase === "mvp").slice(0, 6);
  const byCoin = coins.map((c) => ({
    symbol: c.symbol,
    emoji: c.emoji,
    amount: local() * 50,
    claimable: local() * 5,
  }));
  const quotes = MOCK_COMMODITY_QUOTES;
  const totalEarnedUsd = byCoin.reduce((sum, b) => {
    const q = quotes.find((x) => x.symbol === b.symbol);
    return sum + b.amount * (q?.priceUsd ?? 1);
  }, 0);
  return { wallet, totalEarnedUsd, byCoin };
}

function hashStr(s: string): number {
  let x = 0;
  for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0;
  return x || 1;
}

export { CATEGORY_LABEL };
