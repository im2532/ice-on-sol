"use client";

import Link from "next/link";
import { shortenAddress } from "@/lib/format";

const ICE_MINT_PLACEHOLDER = "ICEmarketspLACEho1derMintAddress1111111111111111";

/**
 * One row on desktop: the mono link cluster and the disclosure share a baseline.
 * Stacks with a 12px gap below sm. Bottom-bar clearance comes from body padding (globals.css).
 */
export default function Footer() {
  return (
    <footer className="container-x relative z-10 mt-auto">
      <div className="flex flex-col gap-3 border-t border-white/[0.08] py-7 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <p className="mono flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
          <span className="text-dim">$ICE</span>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(ICE_MINT_PLACEHOLDER).catch(() => {})}
            title={ICE_MINT_PLACEHOLDER}
            aria-label="Copy the $ICE mint address"
            className="tap rounded underline decoration-dotted underline-offset-4 hover:text-text"
          >
            {shortenAddress(ICE_MINT_PLACEHOLDER, 4)}
          </button>
          <span aria-hidden="true">·</span>
          <Link href="/docs" className="tap rounded hover:text-text">
            How it works
          </Link>
          <span aria-hidden="true">·</span>
          <a
            href={`https://solscan.io/token/${ICE_MINT_PLACEHOLDER}`}
            target="_blank"
            rel="noreferrer noopener"
            className="tap rounded hover:text-text"
          >
            Explorer
          </a>
        </p>
        <p className="max-w-[520px] text-[12px] leading-relaxed text-muted sm:text-right">
          Commodity coins are synthetic, track a reference price via oracle, are redeemable only against the
          protocol reserve, and may halt — not available to US, UK or sanctioned persons.
        </p>
      </div>
    </footer>
  );
}
