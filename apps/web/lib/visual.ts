/**
 * Glacier visual helpers — pure functions shared by the heat grid, market icons and tiles.
 * Deterministic: the same symbol always paints the same swatch, so SSR and CSR agree.
 */

/** Hand-picked swatches for the commodity coins in the mockups; everything else is hashed. */
const SWATCH: Record<string, [string, string]> = {
  GLD: ["#F6D365", "#B8860B"],
  SLV: ["#F1F3F8", "#B9BFD0"],
  XPT: ["#DDE3EE", "#8E97A8"],
  XPD: ["#CFE7DE", "#6E9C8B"],
  HG: ["#B87333", "#E8A868"],
  ALI: ["#D6DCE6", "#9AA4B4"],
  CL: ["#2B2B2B", "#000000"],
  BZ: ["#3A3226", "#15110C"],
  NG: ["#14F195", "#0F9F6B"],
  CC: ["#6B3E1E", "#3B2314"],
  KC: ["#7B4A26", "#40230F"],
  ZW: ["#E3C878", "#A98436"],
  ZC: ["#F2D680", "#C89A2A"],
  DC: ["#F1F3F8", "#B9BFD0"],
  CT: ["#F5F5F2", "#C9C9C0"],
  DAYTONA: ["#2EC4B6", "#0B7285"],
  SUBMARINER: ["#1E5A8A", "#0A2B44"],
  ROYALOAK: ["#8892A6", "#454E60"],
  RSGP: ["#9945FF", "#5B2ED6"],
  BURGER: ["#FFD166", "#FF8C42"],
};

const PALETTE: [string, string][] = [
  ["#9945FF", "#5B2ED6"],
  ["#14F195", "#0F9F6B"],
  ["#2EC4B6", "#0B7285"],
  ["#FFD166", "#FF8C42"],
  ["#FF5C7A", "#B02745"],
  ["#B87333", "#E8A868"],
  ["#6C8CFF", "#2F4BC0"],
  ["#C9B6FF", "#7A5BD0"],
];

function hash(s: string): number {
  let x = 0;
  for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0;
  return x;
}

/** `linear-gradient(...)` for a commodity or market icon, stable per key. */
export function swatch(key: string): string {
  const pair = SWATCH[key] ?? PALETTE[hash(key) % PALETTE.length];
  return `linear-gradient(135deg, ${pair[0]}, ${pair[1]})`;
}

/** The lead color of a swatch — used for the small square inside a "Paired with X" chip. */
export function swatchColor(key: string): string {
  return (SWATCH[key] ?? PALETTE[hash(key) % PALETTE.length])[0];
}

/**
 * Heat-grid tile background: green tinted when up, red when down, neutral at flat.
 * Alpha scales with |change| up to ±3%, matching the tile stack in Main.dc.html.
 */
export function heatBackground(change24h: number): string {
  if (!Number.isFinite(change24h) || Math.abs(change24h) < 0.005) return "rgba(255,255,255,0.04)";
  const intensity = Math.min(1, Math.abs(change24h) / 3);
  const alpha = (0.06 + intensity * 0.14).toFixed(3);
  return change24h > 0 ? `rgba(20,241,149,${alpha})` : `rgba(255,92,122,${alpha})`;
}

/** "Graduated" once the curve is full, otherwise "72%" (read as "% of curve"). */
export function curveLabel(pct: number, migrated: boolean): string {
  if (migrated || pct >= 100) return "Graduated";
  return `${Math.round(Math.max(0, Math.min(100, pct)))}%`;
}

/** A minus sign that reads as a minus at any size, matching the mockups' −0.08%. */
export function signed(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "—";
  const body = Math.abs(value).toFixed(decimals);
  if (value > 0) return `+${body}`;
  if (value < 0) return `−${body}`;
  return body;
}
