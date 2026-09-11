"use client";

import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { shortenAddress } from "@/lib/format";

/** Connected: a mono address chip with a live dot. Disconnected: a ghost "Connect". */
export default function ConnectButton({ className = "" }: { className?: string }) {
  const { setVisible } = useWalletModal();
  const { publicKey, disconnect, connecting } = useWallet();

  if (publicKey) {
    return (
      <button
        type="button"
        onClick={() => disconnect()}
        aria-label="Disconnect wallet"
        className={`chip mono tap ${className}`}
        style={{ height: 34 }}
      >
        <span
          className="h-[7px] w-[7px] rounded-full bg-positive"
          style={{ boxShadow: "0 0 10px #14F195" }}
          aria-hidden="true"
        />
        {shortenAddress(publicKey.toBase58())}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setVisible(true)}
      aria-label="Connect wallet"
      disabled={connecting}
      className={`btn-ghost tap ${className}`}
      style={{ height: 38, borderRadius: 12 }}
    >
      {connecting ? "Connecting…" : "Connect"}
    </button>
  );
}
