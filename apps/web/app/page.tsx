"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { fetchCommodities, fetchStats } from "@/lib/api";
import { compact } from "@/lib/format";
import CommodityHeat from "@/components/CommodityHeat";
import MarketsTable from "@/components/MarketsTable";
import RewardsFeed from "@/components/RewardsFeed";
import FeeDonut from "@/components/FeeDonut";
import IceCard from "@/components/IceCard";

export default function MarketsPage() {
  const { data: stats } = useQuery({ queryKey: ["stats"], queryFn: fetchStats });
  const { data: commodities } = useQuery({ queryKey: ["commodities"], queryFn: fetchCommodities });

  return (
    <div className="container-x pb-16 pt-8 md:pt-14">
      {/* ---- statement + commodity heat ---- */}
      <section className="grid gap-6 lg:grid-cols-[5fr_7fr] lg:items-start lg:gap-7">
        <div className="flex flex-col justify-between gap-[60px]">
          <div className="flex flex-col gap-4 md:gap-5">
            <span className="eyebrow">Commodity market exchange · Solana</span>
            {/*
              The statement column is 5fr of the 1280px grid ≈ 502px. "Markets paired with" needs
              ~474px at 48px Sora and ~553px at 56px, so 48px is the largest size that still breaks
              as "Markets paired with / real commodities." Balance picks that break; the 20ch cap
              keeps it from going wider at md.
            */}
            <h1 className="display max-w-[20ch] text-[34px] font-bold leading-[1.02] text-white [text-wrap:balance] md:text-[44px] lg:text-[48px] lg:leading-[1.06]">
              Markets paired with real commodities.
            </h1>
            <p className="max-w-[52ch] text-[15px] leading-relaxed text-body md:text-[17px]">
              Launch a token paired with gold, crude, wheat, a Dragon Lore or a Daytona — any of 93 commodity
              coins. 40% of every trading fee is paid to holders in that commodity, every fifteen minutes,
              with nothing to claim.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/launch" className="btn-primary tap">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#05060B" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Launch a market
              </Link>
              <Link href="/commodities" className="btn-ghost tap">
                Browse commodities
              </Link>
            </div>
          </div>

          <div className="glass grid grid-cols-3 gap-3 px-4 py-4 sm:px-5">
            <Stat label="Markets" value={stats ? stats.marketsCount.toLocaleString("en-US") : "—"} />
            <Stat
              label="Paid out · 24h"
              value={stats ? compact(stats.paidToHolders24hUsd) : "—"}
              className="text-positive"
            />
            <Stat label="Value locked" value={stats ? compact(stats.valueLockedUsd) : "—"} />
          </div>
        </div>

        <CommodityHeat commodities={commodities} />
      </section>

      {/* ---- markets + right rail ---- */}
      <section className="mt-6 grid gap-6 lg:mt-10 lg:grid-cols-[8fr_4fr] lg:items-start lg:gap-7">
        <MarketsTable />
        <div className="flex flex-col gap-5">
          <RewardsFeed />
          <FeeDonut />
          <IceCard stats={stats} />
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="eyebrow">{label}</span>
      <span className={`mono text-xl font-semibold sm:text-2xl ${className}`}>{value}</span>
    </div>
  );
}
