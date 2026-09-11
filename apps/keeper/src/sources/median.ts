/**
 * Shared median-of-up-to-3-sources combiner, used by the Switchboard relay for both
 * `watch_*` (WatchCharts + Chrono24-stub + Collector Crypt) and `tcg_*` (pokemontcg.io +
 * Collector Crypt) jobs. Mirrors the `medianTask` step in the Switchboard job JSON
 * (`switchboard/jobs/*-median.json`) so the keeper-side relay produces the same number the
 * on-demand oracle would once it's live.
 *
 * Rules: drop nulls/non-positive readings; require at least 2 surviving readings; reject
 * (drop) any single reading that deviates more than 25% from the median of the others
 * before taking the final median. If fewer than 2 readings survive the deviation check,
 * the whole thing fails (returns null) — callers fall back to a manual/seed price.
 */

export interface SourceReading {
  price: number;
  source: string;
}

export interface MedianResult {
  price: number;
  sourcesUsed: number;
  sources: string[];
}

const MAX_DEVIATION_PCT = 25;

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Combines up to 3 (nullable) source readings into one median, dropping outliers.
 * Accepts `null` entries (a source that failed to respond) directly so call sites can pass
 * `[a, b, c]` from `Promise.all` without pre-filtering.
 */
export function median3(readings: (SourceReading | null | undefined)[]): MedianResult | null {
  const valid = readings.filter((r): r is SourceReading => !!r && r.price > 0 && Number.isFinite(r.price));
  if (valid.length < 2) return null;

  // First pass: a provisional median of everything that responded, used only to detect
  // outliers (mirrors "rejects a source deviating >25% from the others").
  const provisionalMedian = medianOf(valid.map((v) => v.price));
  const kept = valid.filter((v) => {
    const deviationPct = (Math.abs(v.price - provisionalMedian) / provisionalMedian) * 100;
    return deviationPct <= MAX_DEVIATION_PCT;
  });
  if (kept.length < 2) return null;

  return {
    price: medianOf(kept.map((v) => v.price)),
    sourcesUsed: kept.length,
    sources: kept.map((v) => v.source),
  };
}
