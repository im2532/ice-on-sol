/** Compact currency marks for payment controls; their adjacent labels provide names. */
export default function CurrencyLogo({ symbol, size = 22 }: { symbol: "USDC" | "SOL"; size?: number }) {
  return symbol === "USDC" ? (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="16" cy="16" r="16" fill="#2775CA" />
      <path d="M19.4 12.2c-.6-1.1-1.8-1.7-3.4-1.7-2 0-3.4 1-3.4 2.6 0 4 7 1.4 7 5.6 0 1.7-1.5 2.8-3.6 2.8-1.8 0-3.2-.8-3.8-2.2M16 8.5v2M16 21.5v2M10 7.7a10.3 10.3 0 0 0 0 16.6M22 7.7a10.3 10.3 0 0 1 0 16.6" stroke="white" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="16" cy="16" r="16" fill="#151515" />
      <path d="M9 8h16l-4 4H5l4-4Z" fill="#80ECBE" />
      <path d="M5 14h16l4 4H9l-4-4Z" fill="#80C8DB" />
      <path d="M9 20h16l-4 4H5l4-4Z" fill="#AB87F5" />
    </svg>
  );
}
