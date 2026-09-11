const R = 36;
const C = 2 * Math.PI * R; // 226.19

const SEGMENTS = [
  { label: "40% holders", pct: 40, color: "#14F195" },
  { label: "20% $ICE burn", pct: 20, color: "#9945FF" },
  { label: "20% exchange", pct: 20, color: "#8B90A6" },
  { label: "20% Meteora", pct: 20, color: "rgba(255,255,255,0.22)" },
];

/**
 * "How a fee splits" — the 40/20/20/20 donut. Replaces the old FeeSplitBar.
 * Holders' 40% is paid in the commodity coin, every cycle, with nothing to claim.
 */
export default function FeeDonut({ size = 88 }: { size?: number }) {
  let offset = 0;
  return (
    <section className="glass flex flex-col gap-3.5 p-5" aria-labelledby="fee-split-heading">
      <h2 id="fee-split-heading" className="eyebrow">
        Where a fee goes
      </h2>
      <div className="flex items-center gap-4">
        <svg
          width={size}
          height={size}
          viewBox="0 0 88 88"
          role="img"
          aria-label="Fee split: 40% to holders, 20% to the $ICE burn, 20% to the exchange, 20% to Meteora"
          className="shrink-0"
        >
          {/* toFixed here is SVG dash geometry, not a displayed number. */}
          <circle cx="44" cy="44" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
          {SEGMENTS.map((s) => {
            const dash = (s.pct / 100) * C;
            const dashOffset = -offset;
            offset += dash;
            return (
              <circle
                key={s.label}
                cx="44"
                cy="44"
                r={R}
                fill="none"
                stroke={s.color}
                strokeWidth="10"
                strokeDasharray={`${dash.toFixed(1)} ${C.toFixed(1)}`}
                strokeDashoffset={dashOffset.toFixed(1)}
                transform="rotate(-90 44 44)"
              />
            );
          })}
        </svg>
        <ul className="mono grid flex-1 grid-cols-2 gap-x-4 gap-y-2">
          {SEGMENTS.map((s) => (
            <li key={s.label} className="flex items-center gap-1.5 text-xs text-dim">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-sm"
                style={{ background: s.color }}
                aria-hidden="true"
              />
              {s.label}
            </li>
          ))}
        </ul>
      </div>
      <p className="text-[13px] leading-relaxed text-body">
        Paid every fifteen minutes in the commodity coin the market is paired with. Nothing to claim; it
        lands in your wallet.
      </p>
    </section>
  );
}
