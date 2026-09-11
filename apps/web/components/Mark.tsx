/**
 * The Glacier mark: a hexagonal ice crystal drawn in the Solana purple→green gradient.
 * Replaces the old ice-cream mascot everywhere in the chrome (the mascot survives on 404 only).
 *
 * Every instance paints the same gradient, so they deliberately share one id — a duplicate
 * <defs> resolves to the identical stops and keeps the markup hydration-stable.
 */
const GRAD_ID = "glacier-mark-gradient";

export function Mark({ size = 30, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className}
      focusable="false"
    >
      <defs>
        <linearGradient id={GRAD_ID} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9945FF" />
          <stop offset="1" stopColor="#14F195" />
        </linearGradient>
      </defs>
      <path
        d="M16 2 L28 9 V23 L16 30 L4 23 V9 Z"
        stroke={`url(#${GRAD_ID})`}
        strokeWidth="1.6"
        fill="rgba(255,255,255,0.04)"
      />
      <path
        d="M16 8 V24 M9 12 L23 20 M23 12 L9 20"
        stroke={`url(#${GRAD_ID})`}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="16" cy="16" r="2.4" fill="#EEF0F6" />
    </svg>
  );
}

/** Mark + wordmark: "ICE" white, "markets" muted. */
export default function Logo({ size = 30, textSize = 16 }: { size?: number; textSize?: number }) {
  return (
    <span className="flex items-center gap-3">
      <Mark size={size} />
      <span className="display font-bold text-white" style={{ fontSize: textSize }}>
        ICE<span className="font-medium text-muted">markets</span>
      </span>
    </span>
  );
}
