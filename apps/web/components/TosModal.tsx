"use client";

import { useEffect, useState } from "react";
import Mascot from "./Mascot";

const TOS_KEY = "icemarkets.tos.accepted.v1";

export default function TosModal() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(TOS_KEY)) setVisible(true);
    } catch {
      // localStorage unavailable (private mode) — don't block the app on it.
    }
  }, []);

  function accept() {
    try {
      window.localStorage.setItem(TOS_KEY, "1");
    } catch {
      /* ignore */
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tos-title"
      className="fixed inset-0 z-[200] flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
    >
      <div className="icemarkets-card w-full max-w-lg p-6 shadow-glow">
        <div className="mb-4 flex items-center gap-3">
          <Mascot size={40} />
          <h2 id="tos-title" className="text-lg font-semibold">
            Before you dive in
          </h2>
        </div>
        <p className="mb-3 text-sm leading-relaxed text-muted">
          ICEmarkets lists synthetic coins whose price tracks a commodity via an oracle feed. They are not
          redeemable for any physical asset — only against the protocol&apos;s USDC reserve — and trading
          may be halted if a price feed goes stale. Nothing here is investment advice, and ICEmarkets is not
          available to persons in the United States, the United Kingdom, or any sanctioned jurisdiction.
        </p>
        <p className="mb-5 text-sm leading-relaxed text-muted">
          By continuing you confirm you are not a resident of a restricted jurisdiction and accept the{" "}
          <a href="/docs" className="text-green underline underline-offset-2">
            Terms of Service and risk disclosures
          </a>
          .
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <a
            href="/restricted"
            className="icemarkets-btn-secondary icemarkets-focus px-4 py-2 text-center text-sm"
          >
            I&apos;m not eligible
          </a>
          <button type="button" onClick={accept} className="icemarkets-btn-primary icemarkets-focus px-4 py-2 text-sm">
            Accept &amp; continue
          </button>
        </div>
      </div>
    </div>
  );
}
