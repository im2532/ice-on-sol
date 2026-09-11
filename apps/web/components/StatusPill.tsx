import type { MarketStatus } from "@/lib/types";

const STYLE: Record<MarketStatus, string> = {
  open: "chip-positive",
  closed: "",
  halted: "chip-warn",
};

const DOT: Record<MarketStatus, string> = {
  open: "bg-positive",
  closed: "bg-muted",
  halted: "bg-negative",
};

const LABEL: Record<MarketStatus, string> = { open: "Open", closed: "Closed", halted: "Halted" };

/** Commodity-coin trading status as a glass chip. */
export default function StatusPill({ status, className = "" }: { status: MarketStatus; className?: string }) {
  return (
    <span className={`chip ${STYLE[status]} ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[status]}`} aria-hidden="true" />
      {LABEL[status]}
    </span>
  );
}
