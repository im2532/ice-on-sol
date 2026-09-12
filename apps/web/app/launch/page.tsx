"use client";

import PageHeader from "@/components/layout/PageHeader";
import { Icon } from "@/components/agentic/Icon/Icon";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { NOT_ALLOWED_MESSAGE, walletAllowed } from "@/lib/allowlist";
import { fetchCommodity } from "@/lib/api";
import { launchMarket } from "@/lib/actions";
import { LAUNCH } from "@icemarkets/registry";
import CommodityPicker from "@/components/wizard/CommodityPicker";
import IdentityFields, {
  EMPTY_IDENTITY,
  type IdentityState,
} from "@/components/wizard/IdentityFields";
import FeeAndBuy, {
  DEFAULT_FEE,
  type FeeState,
} from "@/components/wizard/FeeAndBuy";
import PreviewCard from "@/components/wizard/PreviewCard";
import { toast } from "@/components/Toast";

export default function LaunchPage() {
  const [commoditySymbol, setCommoditySymbol] = useState("ALI");
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

  const ready =
    identity.name.trim().length > 0 &&
    identity.ticker.trim().length > 0 &&
    !!identity.imageUri;

  async function handleLaunch() {
    if (!publicKey) {
      setVisible(true);
      return;
    }
    if (!walletAllowed(publicKey)) {
      toast.error(NOT_ALLOWED_MESSAGE);
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
        { connection, sendTransaction },
      );
    } catch {
      // launchMarket already surfaces a toast
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="agentic-page container-x pb-16 pt-8 md:pt-12">
      <PageHeader
        eyebrow="Create something new"
        title="Launch a market"
        description="Choose a commodity, give your token an identity, and make the first buy. Your market starts here."
      />
      <div className="launch-grid">
        <div className="flex flex-col gap-5">
          <CommodityPicker
            selected={commoditySymbol}
            onSelect={setCommoditySymbol}
          />
          <IdentityFields value={identity} onChange={setIdentity} />
          <FeeAndBuy
            value={fee}
            onChange={setFee}
            commoditySymbol={commoditySymbol}
          />
        </div>

        <div className="lg:sticky lg:top-6 flex flex-col gap-4">
          <h2 className="eyebrow">Your market, as it will appear</h2>
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
          <div className="flex items-center gap-2 text-xs text-muted">
            <Icon name="meter" size={16} />
            Live preview · updates as you edit
          </div>
        </div>
      </div>
    </div>
  );
}
