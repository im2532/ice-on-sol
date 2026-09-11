/**
 * Cluster-dependent addresses for the browser. USDC comes from `@icemarkets/registry` `USDC[cluster]`
 * (cluster = `SOLANA_CLUSTER`, inlined by next.config.ts), with `USDC_MINT_OVERRIDE` as an explicit
 * escape hatch (required on localnet) — the same rule as apps/keeper/src/config.ts and the scripts.
 */
import { PublicKey } from "@solana/web3.js";
import { parseCluster, usdcMintFor, type Cluster } from "@icemarkets/registry";

export const CLUSTER: Cluster = parseCluster(process.env.ICEMARKETS_CLUSTER ?? process.env.NEXT_PUBLIC_CLUSTER, "devnet");

export const USDC_MINT = new PublicKey(usdcMintFor(CLUSTER, process.env.ICEMARKETS_USDC_MINT_OVERRIDE || null));

export const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

const DEPLOYMENTS_BASE = process.env.NEXT_PUBLIC_DEPLOYMENTS_BASE ?? "/deployments";

let altAddressPromise: Promise<PublicKey | null> | null = null;

/**
 * Launch lookup-table address: `NEXT_PUBLIC_LAUNCH_ALT` if set, else `addressLookupTable` from
 * `/deployments/<cluster>.json` (copied from the repo's deployments/ by `make alt` / `make web-deployments`).
 * Null when neither exists — the launch builder then compiles without an ALT (and may exceed the size limit).
 */
export function fetchLaunchAltAddress(): Promise<PublicKey | null> {
  altAddressPromise ??= (async () => {
    const fromEnv = process.env.ICEMARKETS_LAUNCH_ALT;
    if (fromEnv) return new PublicKey(fromEnv);
    try {
      const res = await fetch(`${DEPLOYMENTS_BASE}/${CLUSTER}.json`, { cache: "no-store" });
      if (!res.ok) return null;
      const json = (await res.json()) as { addressLookupTable?: string };
      return json.addressLookupTable ? new PublicKey(json.addressLookupTable) : null;
    } catch {
      return null;
    }
  })();
  return altAddressPromise;
}
