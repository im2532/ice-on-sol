/**
 * Trading-card pricing via pokemontcg.io (TCGplayer/Cardmarket market prices). Per
 * docs/research/03 §2: "Define the grade exactly (for example PSA 10 versus raw)". MVP
 * treats every card/box symbol as the raw/ungraded market price from TCGplayer, since
 * pokemontcg.io's `tcgplayer.prices` block gives that directly without a separate grading
 * API; a future revision can add PSA/BGS grading via pokemonpricetracker for the
 * single-card SIRs that trade at a meaningful graded premium (UMBREONEX, ZARDEX199, etc).
 *
 * // CHECK: pokemontcg.io could not be reached from this sandbox (no network). Card name
 * -> API query mapping below is best-effort from the registry's display names; confirm
 * against the live API's card name matching (it's a fuzzy `q=name:"..."` Lucene-style
 * query) before relying on it.
 */
import { loadConfig } from "../config";
import { childLogger } from "../logger";

const log = childLogger("sources/tcg");

/** Registry symbol -> pokemontcg.io search query. CHECK: refine against real card names/set codes. */
const CARD_QUERY: Record<string, string> = {
  ETB151: "name:\"151 Elite Trainer Box\"",
  ETBPRISM: "name:\"Prismatic Evolutions\" Elite Trainer Box",
  ZARDBASE: "name:\"Charizard\" set.id:base1",
  MOONBREON: "name:\"Umbreon VMAX\" (Alt Art OR Alternate Art)",
  UMBREONEX: "name:\"Umbreon ex\"",
  PIKAEX238: "name:\"Pikachu ex\" number:238",
};

interface PokemonTcgCard {
  id: string;
  name: string;
  tcgplayer?: { prices?: Record<string, { market?: number; mid?: number }> };
}

export async function fetchTcgPrice(symbol: string): Promise<number | null> {
  const cfg = loadConfig();
  const query = CARD_QUERY[symbol];
  if (!query) {
    log.warn({ symbol }, "no pokemontcg.io query mapping for symbol");
    return null;
  }
  try {
    const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(query)}&pageSize=1`;
    const res = await fetch(url, {
      headers: cfg.pokemonTcgApiKey ? { "X-Api-Key": cfg.pokemonTcgApiKey } : {},
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: PokemonTcgCard[] };
    const card = body.data?.[0];
    if (!card?.tcgplayer?.prices) return null;
    // Prefer the highest-liquidity variant's market price (holofoil > normal > 1stEdition, etc).
    const variants = Object.values(card.tcgplayer.prices);
    const market = variants.map((v) => v.market ?? v.mid).find((p): p is number => typeof p === "number" && p > 0);
    return market ?? null;
  } catch (err) {
    log.warn({ symbol, err: String(err) }, "pokemontcg.io fetch failed");
    return null;
  }
}
