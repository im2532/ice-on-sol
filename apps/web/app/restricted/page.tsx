import type { Metadata } from "next";
import Mascot from "@/components/Mascot";

export const metadata: Metadata = { title: "Restricted — ICEmarkets" };

export default function RestrictedPage() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-5 px-4 py-24 text-center">
      <Mascot size={72} mood="sad" />
      <h1 className="text-2xl font-semibold">ICEmarkets isn&apos;t available in your region</h1>
      <p className="text-sm leading-relaxed text-muted">
        ICEmarkets is not offered to persons located in the United States, the United Kingdom, or any
        sanctioned jurisdiction, in line with our compliance policy. If you believe this is a mistake,
        reach out on{" "}
        <a
          href="https://x.com/launchonicemarkets"
          target="_blank"
          rel="noreferrer noopener"
          className="text-green underline underline-offset-2"
        >
          X
        </a>
        .
      </p>
    </div>
  );
}
