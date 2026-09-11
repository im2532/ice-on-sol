import Link from "next/link";
import { shortenAddress } from "@/lib/format";

const ICE_MINT_PLACEHOLDER = "ICEmarketspLACEho1derMintAddress1111111111111111";

export default function Footer() {
  return (
    <footer className="border-t border-border/70 bg-surface/40">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="font-nums">
            $ICE{" "}
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(ICE_MINT_PLACEHOLDER).catch(() => {});
              }}
              className="icemarkets-focus rounded underline decoration-dotted underline-offset-4 hover:text-text"
              aria-label="Copy $ICE mint address"
              title={ICE_MINT_PLACEHOLDER}
            >
              {shortenAddress(ICE_MINT_PLACEHOLDER)}
            </button>
          </span>
          <Link href="/docs" className="icemarkets-focus rounded hover:text-text">
            How it works
          </Link>
          <a
            href={`https://solscan.io/token/${ICE_MINT_PLACEHOLDER}`}
            target="_blank"
            rel="noreferrer noopener"
            className="icemarkets-focus rounded hover:text-text"
          >
            Explorer ↗
          </a>
        </div>
        <p className="max-w-xl leading-relaxed">
          ICEmarkets coins are synthetic and track commodity prices via an oracle — they are not redeemable for
          any physical asset, only against the protocol&apos;s reserve, and may halt trading. Not available
          to US/UK/sanctioned persons.{" "}
          <Link href="/docs" className="underline decoration-dotted underline-offset-4 hover:text-text">
            Full disclosures
          </Link>
          .
        </p>
      </div>
    </footer>
  );
}
