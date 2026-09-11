"use client";

import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { shortenAddress } from "@/lib/format";

export default function ConnectButton({ className = "" }: { className?: string }) {
  const { setVisible } = useWalletModal();
  const { publicKey, disconnect, connecting } = useWallet();

  if (publicKey) {
    return (
      <button
        type="button"
        onClick={() => disconnect()}
        aria-label="Disconnect wallet"
        className={`icemarkets-btn-secondary icemarkets-focus px-4 py-2 text-sm font-medium font-nums ${className}`}
      >
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
      className={`icemarkets-btn-secondary icemarkets-focus px-4 py-2 text-sm font-medium ${className}`}
    >
      {connecting ? "Connecting…" : "Connect wallet"}
    </button>
  );
}
