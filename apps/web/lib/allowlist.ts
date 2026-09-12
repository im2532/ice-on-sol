/**
 * Guarded-launch wallet allowlist (MAINNET_RUNBOOK §5). `NEXT_PUBLIC_ALLOWED_WALLETS` is a comma-separated list
 * of base58 pubkeys; when it is non-empty the trade and launch UIs refuse any other connected wallet. Unset or
 * empty = open to everyone (post-audit). This is a UI gate only — on-chain access is bounded by the caps, not by
 * this list.
 */
import type { PublicKey } from "@solana/web3.js";

const RAW = process.env.NEXT_PUBLIC_ALLOWED_WALLETS ?? "";

export const ALLOWED_WALLETS: ReadonlySet<string> = new Set(
  RAW.split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

/** True when the guarded launch allowlist is active. */
export const ALLOWLIST_ACTIVE = ALLOWED_WALLETS.size > 0;

/** A wallet may trade/launch: always when no allowlist is configured, else only if listed. */
export function walletAllowed(wallet: PublicKey | string | null | undefined): boolean {
  if (!ALLOWLIST_ACTIVE) return true;
  if (!wallet) return false;
  return ALLOWED_WALLETS.has(typeof wallet === "string" ? wallet : wallet.toBase58());
}

export const NOT_ALLOWED_MESSAGE = "Guarded launch: this wallet is not on the team allowlist yet";
