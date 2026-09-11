import { Commodity, OracleKind as O, SessionKind as S } from "./types";

// ---- parameter presets by tier -------------------------------------------
const P = {
  A24: { baseSpreadBps: 10, closedSpreadBps: 10, confMultBps: 50, maxAgeOpenSec: 60, maxAgeClosedSec: 60, supplyCapUsd: 250_000, perTxCapUsd: 25_000 },
  AHours: { baseSpreadBps: 15, closedSpreadBps: 150, confMultBps: 50, maxAgeOpenSec: 120, maxAgeClosedSec: 72 * 3600, supplyCapUsd: 150_000, perTxCapUsd: 15_000 },
  B: { baseSpreadBps: 25, closedSpreadBps: 150, confMultBps: 100, maxAgeOpenSec: 300, maxAgeClosedSec: 72 * 3600, supplyCapUsd: 75_000, perTxCapUsd: 7_500 },
  BMkt: { baseSpreadBps: 100, closedSpreadBps: 100, confMultBps: 100, maxAgeOpenSec: 3600, maxAgeClosedSec: 3600, supplyCapUsd: 50_000, perTxCapUsd: 5_000 },
  C: { baseSpreadBps: 150, closedSpreadBps: 150, confMultBps: 100, maxAgeOpenSec: 48 * 3600, maxAgeClosedSec: 48 * 3600, supplyCapUsd: 25_000, perTxCapUsd: 2_500 },
  CManual: { baseSpreadBps: 200, closedSpreadBps: 200, confMultBps: 0, maxAgeOpenSec: 30 * 86400, maxAgeClosedSec: 30 * 86400, supplyCapUsd: 25_000, perTxCapUsd: 2_500 },
} as const;

const EURUSD = "a995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b"; // Pyth FX.EUR/USD

const pyth = (pythSymbol: string, feedId: string | null, quote: "USD" | "USc" | "EUR" = "USD") => ({
  kind: O.PythPull, pythSymbol, feedId, quote, ...(quote === "EUR" ? { fxFeedId: EURUSD } : {}),
});
const sb = (switchboardJob: string) => ({ kind: O.Switchboard, switchboardJob });
const manual = (cadenceSec: number) => ({ kind: O.KeeperSigned, cadenceSec });

// ---- the list --------------------------------------------------------------
export const COMMODITIES: Commodity[] = [
  // METALS ---------------------------------------------------------------
  { symbol: "GLD", name: "Gold", category: "metals", unit: "1 troy oz", unitShort: "oz", tier: "A24", session: S.Continuous, phase: "mvp", emoji: "🥇",
    oracle: pyth("Metal.Index.GOLD/USD", "fa0f57505be633c026896e15afef2c7ce2cf8ff9a45349d1da737f4f01266b01"), params: P.A24 },
  { symbol: "SLV", name: "Silver", category: "metals", unit: "1 troy oz", unitShort: "oz", tier: "A24", session: S.Continuous, phase: "mvp", emoji: "🥈",
    oracle: pyth("Metal.Index.SILVER/USD", "6afca47e1c79ecd0d2844327efb463478417a9d498dfb0915ce5e88ae6d952d3"), params: P.A24 },
  { symbol: "XPT", name: "Platinum", category: "metals", unit: "1 troy oz", unitShort: "oz", tier: "AHours", session: S.CmeGlobex, phase: "mvp", emoji: "⚪",
    oracle: pyth("Metal.XPT/USD", "398e4bbc7cbf89d6648c21e08019d878967677753b3096799595c78f805a34e5"), params: P.AHours },
  { symbol: "XPD", name: "Palladium", category: "metals", unit: "1 troy oz", unitShort: "oz", tier: "AHours", session: S.CmeGlobex, phase: "mvp", emoji: "⚫",
    oracle: pyth("Metal.XPD/USD", "80367e9664197f37d89a07a804dffd2101c479c7c4e8490501bc9d9e1e7f9021"), params: P.AHours },
  { symbol: "HG", name: "Copper", category: "metals", unit: "1 lb", unitShort: "lb", tier: "A24", session: S.Continuous, phase: "mvp", emoji: "🟤",
    oracle: pyth("Commodities.Index.CU/USD", "b2b238aeb6ef5a722c5cf278595bf40434e174cac4f88c8ad5b6f5009b548c59"), params: P.A24 },
  { symbol: "ALI", name: "Aluminium", category: "metals", unit: "1 metric ton", unitShort: "t", tier: "AHours", session: S.Lme, phase: "mvp", emoji: "🔩",
    oracle: pyth("Metal.AL3M/USD", "9397ba38556359e78a52853b5db5e350e86b9e9a6c01094698130112f3d10cb6"), params: P.AHours },

  // ENERGY ---------------------------------------------------------------
  { symbol: "CL", name: "WTI Crude", category: "energy", unit: "1 barrel", unitShort: "bbl", tier: "AHours", session: S.CmeGlobex, phase: "mvp", emoji: "🛢️",
    oracle: pyth("Commodities.Index.WTI1M/USD", null), params: P.AHours },
  { symbol: "BZ", name: "Brent Crude", category: "energy", unit: "1 barrel", unitShort: "bbl", tier: "A24", session: S.Continuous, phase: "mvp", emoji: "🛢️",
    oracle: pyth("Commodities.Index.BRENT/USD", "f33ce961935076ef4dc98be75cf2126046eac1bffdcd7a0fa05ccf18b746fda6"), params: P.A24 },
  { symbol: "OIL", name: "Oil (Pyth 24/7 blend)", category: "energy", unit: "1 barrel", unitShort: "bbl", tier: "A24", session: S.Continuous, phase: "mvp", emoji: "🛢️",
    oracle: pyth("Commodities.Index.PYTHOIL/USD", "67784f72e95ac01337edb7d7bd5bbd1c03669101b7068a620df228ed4e52ef14"), params: P.A24 },
  { symbol: "USO", name: "Oil fund exposure", category: "energy", unit: "1 unit", unitShort: "unit", tier: "AHours", session: S.CmeGlobex, phase: "mvp", emoji: "📈",
    oracle: pyth("Equity.US.USO/USD", "d00bd77d97dc5769de77f96d0e1a79cbf1364e14d0dbf046e221bce2e89710dd"), params: P.AHours },
  { symbol: "NG", name: "Natural Gas", category: "energy", unit: "1 MMBtu", unitShort: "MMBtu", tier: "A24", session: S.Continuous, phase: "mvp", emoji: "🔥",
    oracle: pyth("Commodities.Index.NATGAS/USD", "45f95717fbe158e896415d1cea33814d73e54169022a8f7bcbb815ebef92f71c"), params: P.A24 },
  { symbol: "RB", name: "Gasoline", category: "energy", unit: "1 gallon", unitShort: "gal", tier: "B", session: S.CmeGlobex, phase: "mvp", emoji: "⛽",
    oracle: sb("nymex_rbob_front_month"), params: P.B },
  { symbol: "HO", name: "Heating Oil", category: "energy", unit: "1 gallon", unitShort: "gal", tier: "B", session: S.CmeGlobex, phase: "mvp", emoji: "🏠",
    oracle: sb("nymex_ho_front_month"), params: P.B },

  // AGRICULTURE ----------------------------------------------------------
  { symbol: "LBR", name: "Lumber", category: "agriculture", unit: "1,000 board ft", unitShort: "mbf", tier: "B", session: S.CmeGlobex, phase: "mvp", emoji: "🪵",
    oracle: sb("cme_lumber_front_month"), params: P.B },
  { symbol: "ZW", name: "Wheat", category: "agriculture", unit: "1 bushel", unitShort: "bu", tier: "AHours", session: S.CmeGlobex, phase: "mvp", emoji: "🌾",
    oracle: pyth("Commodities.WHZ6/USD", "3f4760e9dcbaa7208a1d72af7edb1642681a48473c33100ee4e85aebf9a1b80f", "USc"), params: P.AHours },
  { symbol: "ZC", name: "Corn", category: "agriculture", unit: "1 bushel", unitShort: "bu", tier: "AHours", session: S.CmeGlobex, phase: "mvp", emoji: "🌽",
    oracle: pyth("Commodities.COZ6/USD", "417f8c1eef7f02018a1f62fa554046ab33cb7bd57dbb0b9a12ff01136c8556b1", "USc"), params: P.AHours },
  { symbol: "ZS", name: "Soybeans", category: "agriculture", unit: "1 bushel", unitShort: "bu", tier: "AHours", session: S.CmeGlobex, phase: "mvp", emoji: "🫘",
    oracle: pyth("Commodities.SOX6/USD", "20b5c568be5e8ac92de4db32c0353bf3d85104d2fd2954fe8cd62e6b59ff2516", "USc"), params: P.AHours },
  { symbol: "ZM", name: "Soybean Meal", category: "agriculture", unit: "1 short ton", unitShort: "ton", tier: "B", session: S.CmeGlobex, phase: "mvp", emoji: "🥣",
    oracle: sb("cbot_soymeal_front_month"), params: P.B },
  { symbol: "ZL", name: "Soybean Oil", category: "agriculture", unit: "1 lb", unitShort: "lb", tier: "B", session: S.CmeGlobex, phase: "mvp", emoji: "🫙",
    oracle: sb("cbot_soyoil_front_month"), params: P.B },
  { symbol: "ZR", name: "Rice", category: "agriculture", unit: "1 cwt", unitShort: "cwt", tier: "B", session: S.CmeGlobex, phase: "mvp", emoji: "🍚",
    oracle: sb("cbot_rice_front_month"), params: P.B },
  { symbol: "ZO", name: "Oats", category: "agriculture", unit: "1 bushel", unitShort: "bu", tier: "B", session: S.CmeGlobex, phase: "mvp", emoji: "🌾",
    oracle: sb("cbot_oats_front_month"), params: P.B },
  { symbol: "SB", name: "Sugar", category: "agriculture", unit: "1 lb", unitShort: "lb", tier: "AHours", session: S.IceUs, phase: "mvp", emoji: "🍬",
    oracle: pyth("Commodities.RSV6/USc", "083ec5425198db3a08d69ac2ac97fd8382bef92cd957526130f2daa48c1f9059", "USc"), params: P.AHours },
  { symbol: "KC", name: "Coffee", category: "agriculture", unit: "1 lb", unitShort: "lb", tier: "AHours", session: S.IceUs, phase: "mvp", emoji: "☕",
    oracle: pyth("Commodities.CFZ6/USc", "a61c21c0ca93300f50f231b52f59e9a6f47a07d33e78c1a9b8f84bd5928a3e8f", "USc"), params: P.AHours },
  { symbol: "CC", name: "Cocoa", category: "agriculture", unit: "1 metric ton", unitShort: "t", tier: "AHours", session: S.IceUs, phase: "mvp", emoji: "🍫",
    oracle: pyth("Commodities.CAZ6/USD", "7452a0c6aa220280021272c3cebaaa0f32cc910cd14ea43460ff8ae2d1e773ea"), params: P.AHours },
  { symbol: "CT", name: "Cotton", category: "agriculture", unit: "1 lb", unitShort: "lb", tier: "B", session: S.IceUs, phase: "mvp", emoji: "☁️",
    oracle: sb("ice_cotton_front_month"), params: P.B },
  { symbol: "OJ", name: "Orange Juice", category: "agriculture", unit: "1 lb", unitShort: "lb", tier: "B", session: S.IceUs, phase: "mvp", emoji: "🍊",
    oracle: sb("ice_oj_front_month"), params: P.B },
  { symbol: "DC", name: "Milk", category: "agriculture", unit: "1 cwt (Class III)", unitShort: "cwt", tier: "B", session: S.CmeGlobex, phase: "mvp", emoji: "🥛",
    oracle: sb("cme_class3_milk_front_month"), params: P.B },

  // LIVESTOCK ------------------------------------------------------------
  { symbol: "LE", name: "Live Cattle", category: "livestock", unit: "1 lb", unitShort: "lb", tier: "AHours", session: S.CmeGlobex, phase: "mvp", emoji: "🐄",
    oracle: pyth("Commodities.LCV6/USc", "38f7825b9a942b6ec6fd63cb9c6d2e6e9903170dce9aba353d279ad0e1172d83", "USc"), params: P.AHours },
  { symbol: "GF", name: "Feeder Cattle", category: "livestock", unit: "1 lb", unitShort: "lb", tier: "B", session: S.CmeGlobex, phase: "mvp", emoji: "🐂",
    oracle: sb("cme_feeder_cattle_front_month"), params: P.B },
  { symbol: "HE", name: "Lean Hogs", category: "livestock", unit: "1 lb", unitShort: "lb", tier: "B", session: S.CmeGlobex, phase: "mvp", emoji: "🐖",
    oracle: sb("cme_lean_hogs_front_month"), params: P.B },

  // FAST FOOD (generic, trademark-safe tickers; displayName is what the user sees) -----
  { symbol: "BURGER", name: "Flagship burger", displayName: "Big Mac", category: "fast_food", unit: "1 sandwich", unitShort: "sandwich", tier: "C", session: S.Slow, phase: "mvp", emoji: "🍔", oracle: manual(7 * 86400), params: P.CManual },
  { symbol: "NUGGETS", name: "10 pc chicken nuggets", displayName: "10 pc McNuggets", category: "fast_food", unit: "1 order", unitShort: "order", tier: "C", session: S.Slow, phase: "mvp", emoji: "🍗", oracle: manual(7 * 86400), params: P.CManual },
  { symbol: "BIGBURGER", name: "Flame-grilled burger", displayName: "Whopper", category: "fast_food", unit: "1 sandwich", unitShort: "sandwich", tier: "C", session: S.Slow, phase: "mvp", emoji: "🍔", oracle: manual(7 * 86400), params: P.CManual },
  { symbol: "CHIXSAND", name: "Chicken sandwich", displayName: "Chick-fil-A Sandwich", category: "fast_food", unit: "1 sandwich", unitShort: "sandwich", tier: "C", session: S.Slow, phase: "mvp", emoji: "🥪", oracle: manual(7 * 86400), params: P.CManual },
  { symbol: "TACO", name: "Crunchy taco", displayName: "Crunchy Taco", category: "fast_food", unit: "1 taco", unitShort: "taco", tier: "C", session: S.Slow, phase: "mvp", emoji: "🌮", oracle: manual(7 * 86400), params: P.CManual },
  { symbol: "BURRITO", name: "Chicken burrito", displayName: "Chicken Burrito", category: "fast_food", unit: "1 burrito", unitShort: "burrito", tier: "C", session: S.Slow, phase: "mvp", emoji: "🌯", oracle: manual(7 * 86400), params: P.CManual },
  { symbol: "LATTE", name: "Grande latte", displayName: "Grande Latte", category: "fast_food", unit: "1 drink", unitShort: "drink", tier: "C", session: S.Slow, phase: "mvp", emoji: "☕", oracle: manual(7 * 86400), params: P.CManual },
  { symbol: "PIZZA", name: "Large pepperoni pizza", displayName: "Large Pepperoni", category: "fast_food", unit: "1 pizza", unitShort: "pizza", tier: "C", session: S.Slow, phase: "mvp", emoji: "🍕", oracle: manual(7 * 86400), params: P.CManual },
  { symbol: "DBLBURGER", name: "Double cheeseburger", displayName: "Double-Double", category: "fast_food", unit: "1 burger", unitShort: "burger", tier: "C", session: S.Slow, phase: "mvp", emoji: "🍔", oracle: manual(7 * 86400), params: P.CManual },
  { symbol: "BACONBRGR", name: "Bacon burger", displayName: "Baconator", category: "fast_food", unit: "1 burger", unitShort: "burger", tier: "C", session: S.Slow, phase: "mvp", emoji: "🥓", oracle: manual(7 * 86400), params: P.CManual },
  { symbol: "SPICYCHIX", name: "Spicy chicken sandwich", displayName: "Popeyes Sandwich", category: "fast_food", unit: "1 sandwich", unitShort: "sandwich", tier: "C", session: S.Slow, phase: "mvp", emoji: "🌶️", oracle: manual(7 * 86400), params: P.CManual },
  { symbol: "MEDCOFFEE", name: "Medium coffee", displayName: "Dunkin Medium Coffee", category: "fast_food", unit: "1 coffee", unitShort: "coffee", tier: "C", session: S.Slow, phase: "mvp", emoji: "☕", oracle: manual(7 * 86400), params: P.CManual },
  { symbol: "FRIES", name: "Medium fries", displayName: "Medium Fries", category: "fast_food", unit: "1 order", unitShort: "order", tier: "C", session: S.Slow, phase: "mvp", emoji: "🍟", oracle: manual(7 * 86400), params: P.CManual },

  // CS2 SKINS ------------------------------------------------------------
  ...([
    ["AKREDLINE", "AK-47 Redline (FT)"], ["AWPASIIMOV", "AWP Asiimov (FT)"], ["DLORE", "AWP Dragon Lore (FT)"], ["HOWL", "M4A4 Howl (FT)"],
    ["KARAMBIT", "Karambit Doppler (FN)"], ["BFLYFADE", "Butterfly Knife Fade (FN)"], ["DEAGLBLAZE", "Desert Eagle Blaze (FN)"], ["GLOCKFADE", "Glock-18 Fade (FN)"],
    ["PRNTSTREAM", "M4A1-S Printstream (FT)"], ["VICEGLOVES", "Sport Gloves Vice (FT)"], ["BRAVOCASE", "Operation Bravo Case"], ["VULCAN", "AK-47 Vulcan (FT)"],
  ] as const).map(([symbol, name]): Commodity => ({
    symbol, name, category: "cs2_skins", unit: "1 item", unitShort: "item", tier: "B", session: S.Continuous, phase: "mvp", emoji: "🔫",
    oracle: sb(`cs2_${symbol.toLowerCase()}_median3`), params: P.BMkt,
  })),

  // GAME GOLD ------------------------------------------------------------
  { symbol: "RSGP", name: "OSRS Gold", category: "game_gold", unit: "1M gp", unitShort: "M gp", tier: "B", session: S.Continuous, phase: "mvp", emoji: "🪙",
    oracle: sb("osrs_gp_median_sellers"), params: P.BMkt },

  // TRADING CARDS ----------------------------------------------------------
  ...([
    ["ETB151", "151 Elite Trainer Box", "box"], ["ETBPRISM", "Prismatic Evolutions ETB", "box"], ["ETBRIVALS", "Destined Rivals ETB", "box"], ["ETBHEROES", "Ascended Heroes ETB", "box"],
    ["ETBCHAOS", "Chaos Rising ETB", "box"], ["ETBPHANTOM", "Phantasmal Flames ETB", "box"], ["ETBMASQ", "Twilight Masquerade ETB", "box"], ["ETBSPARKS", "Surging Sparks ETB", "box"],
    ["ETBBOLT", "Black Bolt ETB", "box"], ["ETBFLARE", "White Flare ETB", "box"], ["ETBMEGA", "Mega Evolution ETB", "box"], ["ETBZENITH", "Crown Zenith ETB", "box"], ["ETBOBSIDN", "Obsidian Flames ETB", "box"],
    ["UMBREONEX", "Umbreon ex SIR 161/131", "card"], ["MOONBREON", "Umbreon VMAX Alt Art", "card"], ["ZARDEX199", "Charizard ex SIR 199/165", "card"], ["ZARDEX223", "Charizard ex SIR 223/197", "card"],
    ["ZARDBASE", "Base Set Charizard", "card"], ["PIKAEX238", "Pikachu ex SIR 238/191", "card"], ["MEWEX232", "Mew ex SIR 232/091", "card"], ["TRMEWTWO", "Team Rocket's Mewtwo ex SIR", "card"],
    ["MEGAZARDY", "Mega Charizard Y ex 294/217", "card"], ["GIRATINAV", "Giratina V Alt Art", "card"], ["GARCHOMPEX", "Cynthia's Garchomp ex SIR", "card"], ["ZOROARKEX", "N's Zoroark ex SIR", "card"],
  ] as const).map(([symbol, name, unit]): Commodity => ({
    symbol, name, category: "trading_cards", unit: `1 ${unit}`, unitShort: unit, tier: "C", session: S.Slow,
    phase: "mvp",
    emoji: unit === "box" ? "📦" : "🃏", oracle: sb(`tcg_${symbol.toLowerCase()}_market`), params: P.C,
  })),

  // WATER / CARS -----------------------------------------------------------
  { symbol: "H2O", name: "California Water", category: "water", unit: "1 acre-foot (NQH2O)", unitShort: "af", tier: "C", session: S.Slow, phase: "mvp", emoji: "💧", oracle: manual(7 * 86400), params: P.CManual },
  { symbol: "LAMBO", name: "Italian supercar", displayName: "Lamborghini Temerario", category: "cars", unit: "1 car (MSRP)", unitShort: "car", tier: "C", session: S.Slow, phase: "mvp", emoji: "🏎️", oracle: manual(30 * 86400), params: P.CManual },

  // WATCHES (secondary-market price, unworn/full-set, median of Chrono24 + WatchCharts + Collector Crypt sales) ----------
  ...([
    ["SUBMARINER", "Rolex Submariner Date 126610LN", "Rolex Submariner"], ["DAYTONA", "Rolex Cosmograph Daytona 126500LN", "Rolex Daytona"],
    ["GMTMASTER", "Rolex GMT-Master II 126710BLNR", "Rolex GMT-Master II"], ["DATEJUST", "Rolex Datejust 41 126334", "Rolex Datejust"],
    ["ROYALOAK", "AP Royal Oak 15510ST", "AP Royal Oak"], ["NAUTILUS", "Patek Philippe Nautilus 5811/1G", "Patek Nautilus"],
    ["SPEEDMSTR", "Omega Speedmaster Moonwatch 310.30.42.50.01.001", "Omega Speedmaster"], ["SANTOS", "Cartier Santos Large WSSA0018", "Cartier Santos"],
    ["GSHOCK", "Casio G-Shock DW-5600E", "G-Shock DW-5600"], ["TISSOTPRX", "Tissot PRX Powermatic 80", "Tissot PRX"],
  ] as const).map(([symbol, name, displayName]): Commodity => ({
    symbol, name, displayName, category: "watches", unit: "1 watch (unworn, full set)", unitShort: "watch", tier: "C", session: S.Slow, phase: "mvp", emoji: "⌚",
    oracle: sb(`watch_${symbol.toLowerCase()}_median3`), params: P.C,
  })),
];

/** Index coins (D6 "baskets"). Created on the Peg Desk as Composite commodities. */
export const INDEX_COINS: Commodity[] = [
  { symbol: "PMX", name: "Precious Metals Index", category: "metals", unit: "1 index unit", unitShort: "idx", tier: "AHours", session: S.CmeGlobex, phase: "mvp", emoji: "💎",
    oracle: { kind: O.Composite, legs: [{ symbol: "GLD", weightBps: 4000 }, { symbol: "SLV", weightBps: 3000 }, { symbol: "XPT", weightBps: 1500 }, { symbol: "XPD", weightBps: 1500 }] }, params: P.AHours },
  { symbol: "WATCHX", name: "Luxury Watch Index", category: "watches", unit: "1 index unit", unitShort: "idx", tier: "C", session: S.Slow, phase: "mvp", emoji: "⌚",
    oracle: { kind: O.Composite, legs: [{ symbol: "SUBMARINER", weightBps: 2500 }, { symbol: "DAYTONA", weightBps: 2500 }, { symbol: "ROYALOAK", weightBps: 2000 }, { symbol: "NAUTILUS", weightBps: 2000 }, { symbol: "SPEEDMSTR", weightBps: 1000 }] }, params: P.C },
  { symbol: "CS2X", name: "CS2 Skins Index", category: "cs2_skins", unit: "1 index unit", unitShort: "idx", tier: "B", session: S.Continuous, phase: "mvp", emoji: "🎮",
    oracle: { kind: O.Composite, legs: [{ symbol: "KARAMBIT", weightBps: 2500 }, { symbol: "HOWL", weightBps: 2500 }, { symbol: "DLORE", weightBps: 2500 }, { symbol: "AWPASIIMOV", weightBps: 1500 }, { symbol: "AKREDLINE", weightBps: 1000 }] }, params: P.BMkt },
];

export const ALL = [...COMMODITIES, ...INDEX_COINS];
export const bySymbol = (s: string) => ALL.find((c) => c.symbol === s);
export const byPhase = (phase: Commodity["phase"]) => COMMODITIES.filter((c) => c.phase === phase);
export const CATEGORY_LABEL: Record<Commodity["category"], string> = {
  metals: "Metals", energy: "Energy", agriculture: "Agriculture", livestock: "Livestock", fast_food: "Fast food",
  cs2_skins: "CS2 skins", game_gold: "Game gold", trading_cards: "Trading cards", water: "Water", cars: "Cars", watches: "Watches",
};
