import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@icemarkets/registry", "@icemarkets/sdk"],
  reactStrictMode: true,
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
