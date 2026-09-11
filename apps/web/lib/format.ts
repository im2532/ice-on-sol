/** Formatting helpers shared across the app. Numerals render in JetBrains Mono via the `mono` class (see docs/DESIGN.md). */

export function usd(value: number, opts: { decimals?: number } = {}): string {
  const { decimals } = opts;
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const d = decimals ?? (abs < 1 ? 4 : abs < 1000 ? 2 : 2);
  return (
    (value < 0 ? "-$" : "$") +
    Math.abs(value).toLocaleString("en-US", {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    })
  );
}

function fixed(value: number, decimals: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * A price, never abbreviated. Precision follows magnitude: <1 → 4 decimals, <10 → 3,
 * otherwise 2 with grouping — except a whole number, which stays a whole number ($28,500,
 * not $28,500.00). Use this for prices; `compact()` is only for market caps and volumes.
 */
export function fmtPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  const abs = Math.abs(value);
  // Sub-tick prices (a token quoted in its commodity coin) would round to 0.0000 on fixed
  // decimals, so they fall back to three significant digits — still exact, never abbreviated.
  if (abs < 0.0001) return value.toLocaleString("en-US", { maximumSignificantDigits: 3 });
  if (Number.isInteger(value)) return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (abs < 1) return fixed(value, 4);
  if (abs < 10) return fixed(value, 3);
  return fixed(value, 2);
}

/** `fmtPrice` with a leading dollar sign. */
export function fmtPriceUsd(value: number): string {
  const body = fmtPrice(value);
  return body === "—" ? body : `$${body}`;
}

/**
 * A quantity of a coin — a holder payout, a balance, a trade size. Shows at least four
 * significant figures (so a fraction of an expensive coin never reads "0.00"), caps at six
 * decimals, and trims trailing zeros. Never abbreviates.
 */
export function fmtAmount(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const abs = Math.abs(value);
  const magnitude = Math.floor(Math.log10(abs));
  const decimals = Math.min(6, Math.max(0, 3 - magnitude));
  return value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

/** Compact form: $5.2K, $1.4M, $79.2K, etc. For market caps and volumes only — never prices. */
export function compact(value: number, opts: { prefix?: string; decimals?: number } = {}): string {
  if (!Number.isFinite(value)) return "—";
  const { prefix = "$", decimals = 1 } = opts;
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}${prefix}${(abs / 1_000_000_000).toFixed(decimals)}B`;
  if (abs >= 1_000_000) return `${sign}${prefix}${(abs / 1_000_000).toFixed(decimals)}M`;
  if (abs >= 1_000) return `${sign}${prefix}${(abs / 1_000).toFixed(decimals)}K`;
  return `${sign}${prefix}${abs.toFixed(decimals)}`;
}

export function compactNum(value: number, decimals = 1): string {
  return compact(value, { prefix: "", decimals });
}

export function pct(value: number, opts: { decimals?: number; showSign?: boolean } = {}): string {
  if (!Number.isFinite(value)) return "—";
  const { decimals = 2, showSign = true } = opts;
  const sign = showSign && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}%`;
}

export function pctClass(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "text-muted";
  return value > 0 ? "text-positive" : "text-negative";
}

export function shortenAddress(address: string, chars = 4): string {
  if (!address) return "";
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

export function timeAgo(input: number | string | Date): string {
  const then = new Date(input).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMo = Math.floor(diffDay / 30);
  if (diffMo < 12) return `${diffMo}mo ago`;
  return `${Math.floor(diffMo / 12)}y ago`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
