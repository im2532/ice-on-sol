import type { Metadata } from "next";
import { Icon } from "@/components/agentic/Icon/Icon";

export const metadata: Metadata = { title: "Restricted — ICEmarkets" };

export default function RestrictedPage() {
  return (
    <div className="agentic-page mx-auto flex max-w-xl flex-col items-center gap-5 px-4 py-24 text-center">
      <Icon name="warning-triangle" size={40} />
      <h1 className="display text-2xl font-bold">
        ICEmarkets isn&apos;t available in your region
      </h1>
      <p className="text-sm leading-relaxed text-body">
        ICEmarkets is not offered to persons located in the United States, the
        United Kingdom, or any sanctioned jurisdiction, in line with our
        compliance policy. If you believe this is a mistake, reach out on{" "}
        <a
          href="https://x.com/TradeOnIce"
          target="_blank"
          rel="noreferrer noopener"
          className="link underline underline-offset-2"
        >
          X
        </a>
        .
      </p>
    </div>
  );
}
