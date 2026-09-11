import path from "node:path";
import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";

// Load the monorepo root .env too (Next only reads apps/web/.env* by default), so SOLANA_CLUSTER is shared.
loadEnvConfig(path.resolve(__dirname, "..", ".."));

/**
 * Cluster selection is shared with the keeper/scripts: `SOLANA_CLUSTER` (root .env) decides which
 * `@icemarkets/registry` USDC mint the browser uses (lib/cluster.ts). Inlined at build time under
 * non-NEXT_PUBLIC names so the same .env works for every app; `NEXT_PUBLIC_CLUSTER` is still honoured
 * for deployments that only set public vars.
 */
const nextConfig: NextConfig = {
  transpilePackages: ["@icemarkets/registry", "@icemarkets/sdk"],
  reactStrictMode: true,
  env: {
    ICEMARKETS_CLUSTER: process.env.SOLANA_CLUSTER ?? process.env.NEXT_PUBLIC_CLUSTER ?? "devnet",
    ICEMARKETS_USDC_MINT_OVERRIDE: process.env.USDC_MINT_OVERRIDE ?? process.env.NEXT_PUBLIC_USDC_MINT_OVERRIDE ?? "",
    ICEMARKETS_LAUNCH_ALT: process.env.NEXT_PUBLIC_LAUNCH_ALT ?? "",
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.irys.xyz" },
      { protocol: "https", hostname: "arweave.net" },
      { protocol: "https", hostname: "**.arweave.net" },
    ],
  },
  experimental: {
    // registry/sdk are TS source, not pre-built — allow Next to compile them directly.
    externalDir: true,
  },
};

export default nextConfig;
