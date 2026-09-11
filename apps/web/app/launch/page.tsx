"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { fetchCommodity } from "@/lib/api";
import { launchMarket } from "@/lib/actions";
import { LAUNCH } from "@icemarkets/registry";
import CommodityPicker from "@/components/wizard/CommodityPicker";
import IdentityFields, { EMPTY_IDENTITY, type IdentityState } from "@/components/wizard/IdentityFields";
import FeeAndBuy, { DEFAULT_FEE, type FeeState } from "@/components/wizard/FeeAndBuy";
import PreviewCard from "@/components/wizard/PreviewCard";
import { toast } from "@/components/Toast";

export default function LaunchPage() {
  const [commoditySymbol, setCommoditySymbol] = useState("GLD");
  const [identity, setIdentity] = useState<IdentityState>(EMPTY_IDENTITY);
  const [fee, setFee] = useState<FeeState>(DEFAULT_FEE);
  const [submitting, setSubmitting] = useState(false);

  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();

  const { data: commodity } = useQuery({
    queryKey: ["commodity", commoditySymbol],
    queryFn: () => fetchCommodity(commoditySymbol),
  });

  const youReceive = useMemo(() => {
    const firstBuy = parseFloat(fee.firstBuyUsd);
    if (!firstBuy || !Number.isFinite(firstBuy)) return undefined;
    // The market opens at a $5,000 cap on the full supply.
    const openPricePerToken = LAUNCH.initialMarketCapUsd / LAUNCH.totalSupply;
    return firstBuy / openPricePerToken;
  }, [fee.firstBuyUsd]);

  const ready = identity.name.trim().length > 0 && identity.ticker.trim().length > 0 && !!identity.imageUri;

  async function handleLaunch() {
    if (!publicKey) {
      setVisible(true);
      return;
    }
    if (!ready) {
      toast.error("Add an image, name and ticker first");
      document.getElementById("launch-name")?.focus();
      return;
    }
    setSubmitting(true);
    try {
      await launchMarket(
        {
          ownerWallet: publicKey,
          commoditySymbol,
          name: identity.name,
          ticker: identity.ticker,
          imageUri: identity.imageUri,
          description: identity.description || undefined,
          website: identity.website || undefined,
          x: identity.x || undefined,
          telegram: identity.telegram || undefined,
          feeBps: fee.feeBps,
          firstBuyUsd: parseFloat(fee.firstBuyUsd) || LAUNCH.minFirstBuyUsd,
          payWith: fee.payWith,
        },
        { connection, sendTransaction }
      );
    } catch {
      // launchMarket already surfaces a toast
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="container-x pb-16 pt-8 md:pt-12">
      <div className="grid gap-6 lg:grid-cols-[7fr_5fr] lg:items-start lg:gap-7">
        <div className="flex flex-col gap-5">
          <header className="flex flex-col gap-2.5">
            <span className="eyebrow">Launch a market</span>
            <h1 className="display text-[32px] font-bold leading-[1.05] text-white md:text-[44px]">
              Pick a commodity. Name it. Buy first.
            </h1>
            <p className="max-w-[560px] text-[15px] leading-relaxed text-body">
              One transaction. Your market opens at a $
              {LAUNCH.initialMarketCapUsd.toLocaleString("en-US")} cap and is tradable on any Solana terminal
              from its first block.
            </p>
          </header>

          <CommodityPicker selected={commoditySymbol} onSelect={setCommoditySymbol} />
          <IdentityFields value={identity} onChange={setIdentity} />
          <FeeAndBuy value={fee} onChange={setFee} commoditySymbol={commoditySymbol} />
        </div>

        <div className="lg:sticky lg:top-6">
          <PreviewCard
            name={identity.name}
            ticker={identity.ticker}
            imagePreview={identity.imagePreview}
            commoditySymbol={commoditySymbol}
            commodity={commodity}
            fee={fee}
            youReceive={youReceive}
            submitting={submitting}
            connected={!!publicKey}
            onLaunch={handleLaunch}
          />
        </div>
      </div>
    </div>
  );
}
