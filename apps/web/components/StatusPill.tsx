import type { MarketStatus } from "@/lib/types";

const STYLE: Record<MarketStatus, string> = {
  open: "bg-positive/10 text-positive border-positive/30",
  closed: "bg-muted/10 text-muted border-border",
  halted: "bg-negative/10 text-negative border-negative/30",
};

const LABEL: Record<MarketStatus, string> = { open: "Open", closed: "Closed", halted: "Halted" };

export default function StatusPill({ status }: { status: MarketStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${STYLE[status]}`}>
      <span
        className={`h-1.5 w-1.5 rounded-full ${status === "open" ? "bg-positive" : status === "halted" ? "bg-negative" : "bg-muted"}`}
        aria-hidden="true"
      />
      {LABEL[status]}
    </span>
  );
}
