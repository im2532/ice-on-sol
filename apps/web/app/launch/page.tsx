"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { fetchCommodity } from "@/lib/api";
import { usd } from "@/lib/format";
import { launchMarket } from "@/lib/actions";
import { LAUNCH } from "@icemarkets/registry";
import Step1Paired from "@/components/wizard/Step1Paired";
import Step2Identity, { type IdentityState } from "@/components/wizard/Step2Identity";
import Step3Fee, { type FeeState } from "@/components/wizard/Step3Fee";
import { toast } from "@/components/Toast";

const EMPTY_IDENTITY: IdentityState = {
  imageUri: "",
  imagePreview: "",
  name: "",
  ticker: "",
  website: "",
  x: "",
  telegram: "",
  description: "",
};
const DEFAULT_FEE: FeeState = { feeBps: 200, payWith: "USDC", firstBuyUsd: "1" };

export default function LaunchPage() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [mode, setMode] = useState<"single" | "basket">("single");
  const [pairedWith, setPairedWith] = useState("GLD");
  const [identity, setIdentity] = useState<IdentityState>(EMPTY_IDENTITY);
  const [fee, setFee] = useState<FeeState>(DEFAULT_FEE);
  const [submitting, setSubmitting] = useState(false);

  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();

  const { data: commodity } = useQuery({
    queryKey: ["commodity", pairedWith],
    queryFn: () => fetchCommodity(pairedWith),
  });

  const referencePrice = commodity?.priceUsd;
  const youReceive = useMemo(() => {
    const firstBuy = parseFloat(fee.firstBuyUsd);
    if (!firstBuy || !Number.isFinite(firstBuy)) return undefined;
    // Rough estimate: launch opens at a $5,000 cap on 1,000,000,000 supply.
    const openPricePerToken = LAUNCH.initialMarketCapUsd / LAUNCH.totalSupply;
    return firstBuy / openPricePerToken;
  }, [fee.firstBuyUsd]);

  const canLaunch = identity.name.trim().length > 0 && identity.ticker.trim().length > 0 && identity.imageUri;

  async function handleLaunch() {
    if (!publicKey) {
      setVisible(true);
      return;
    }
    if (!canLaunch) {
      toast.error("Add an image, name and ticker first");
      setStep(2);
      return;
    }
    setSubmitting(true);
    try {
      await launchMarket(
        {
          ownerWallet: publicKey,
          commoditySymbol: pairedWith,
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
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold sm:text-3xl">Launch a market</h1>
      <p className="mt-2 max-w-xl text-sm text-muted">
        Pick a coin it trades against, name it, set the fee and make the first buy. One transaction.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="icemarkets-card divide-y divide-border">
          <WizardSection
            index={1}
            title="Paired with"
            open={step === 1}
            done={step > 1}
            onOpen={() => setStep(1)}
            summary={commodity ? `${commodity.symbol} — ${commodity.displayName ?? commodity.name}` : pairedWith}
          >
            <Step1Paired mode={mode} onModeChange={setMode} selected={pairedWith} onSelect={setPairedWith} referencePriceUsd={referencePrice} />
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={() => setStep(2)} className="icemarkets-btn-primary icemarkets-focus px-5 py-2 text-sm">
                Continue
              </button>
            </div>
          </WizardSection>

          <WizardSection
            index={2}
            title="Identity"
            open={step === 2}
            done={step > 2}
            onOpen={() => setStep(2)}
            summary="Image, name and ticker"
          >
            <Step2Identity value={identity} onChange={setIdentity} />
            <div className="mt-4 flex justify-between">
              <button type="button" onClick={() => setStep(1)} className="icemarkets-btn-secondary icemarkets-focus px-5 py-2 text-sm">
                Back
              </button>
              <button type="button" onClick={() => setStep(3)} className="icemarkets-btn-primary icemarkets-focus px-5 py-2 text-sm">
                Continue
              </button>
            </div>
          </WizardSection>

          <WizardSection
            index={3}
            title="Fee & first buy"
            open={step === 3}
            done={false}
            onOpen={() => setStep(3)}
            summary={`${fee.feeBps / 100}% fee`}
          >
            <Step3Fee value={fee} onChange={setFee} commoditySymbol={pairedWith} youReceive={youReceive} />
            <div className="mt-4 flex justify-between">
              <button type="button" onClick={() => setStep(2)} className="icemarkets-btn-secondary icemarkets-focus px-5 py-2 text-sm">
                Back
              </button>
            </div>
          </WizardSection>
        </div>

        <aside className="icemarkets-card h-fit p-5 lg:sticky lg:top-20">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Overview</h2>
          <dl className="space-y-2.5 text-sm">
            <Row k="Paired with" v={pairedWith} />
            <Row k="Supply" v={LAUNCH.totalSupply.toLocaleString("en-US")} />
            <Row k="Opens at" v={`${usd(LAUNCH.initialMarketCapUsd, { decimals: 0 })} cap`} />
            <Row k="Curve cap" v={usd(LAUNCH.migrationMarketCapUsd, { decimals: 0 })} />
            <Row k="Trading fee" v={`${fee.feeBps / 100}%`} />
            <Row k="First buy" v={fee.firstBuyUsd ? `$${fee.firstBuyUsd}` : "—"} />
            <Row k="You receive" v={youReceive != null ? youReceive.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "—"} />
          </dl>
          <p className="mt-4 text-xs text-muted">
            On-chain cost ≈ 0.025 SOL (config rent + Metaplex + pool) plus your first buy.
          </p>
          <button
            type="button"
            onClick={handleLaunch}
            disabled={submitting}
            className="icemarkets-btn-primary icemarkets-focus mt-4 w-full py-2.5 text-sm"
          >
            {submitting ? "Confirm in wallet…" : publicKey ? "Launch" : "Connect wallet to launch"}
          </button>
        </aside>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted">{k}</dt>
      <dd className="font-nums font-medium">{v}</dd>
    </div>
  );
}

function WizardSection({
  index,
  title,
  open,
  done,
  summary,
  onOpen,
  children,
}: {
  index: number;
  title: string;
  open: boolean;
  done: boolean;
  summary: string;
  onOpen: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="p-5">
      <button
        type="button"
        onClick={onOpen}
        aria-expanded={open}
        className="icemarkets-focus flex w-full items-center gap-3 rounded text-left"
      >
        <span
          className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${
            done ? "bg-green text-[#06120c]" : open ? "bg-purple text-white" : "bg-surface2 text-muted"
          }`}
        >
          {done ? "✓" : index}
        </span>
        <span className="font-semibold">{title}</span>
        {!open && <span className="ml-auto truncate text-xs text-muted">{summary}</span>}
      </button>
      {open && <div className="mt-4">{children}</div>}
    </section>
  );
}
