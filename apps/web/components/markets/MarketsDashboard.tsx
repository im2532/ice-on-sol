"use client";
import SearchField from "@/components/layout/SearchField";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  fetchCommodities,
  fetchMarkets,
  fetchRecentPayouts,
  fetchStats,
  type MarketsQuery,
} from "@/lib/api";
import {
  compact,
  fmtAmount,
  fmtPriceUsd,
  shortenAddress,
  timeAgo,
} from "@/lib/format";
import { signed } from "@/lib/visual";
import type { Market } from "@/lib/types";
import { Button } from "@/components/agentic/Button";
import { Input } from "@/components/agentic/Input";
import { Select } from "@/components/agentic/Select";
import { TabGroup, Tab } from "@/components/agentic/TabGroup";
import { ProgressBar } from "@/components/agentic/ProgressBar";
import { Icon } from "@/components/agentic/Icon/Icon";
import CommodityLogo from "@/components/CommodityLogo";
import styles from "./MarketsDashboard.module.css";

const TABS = [
  { key: "all", label: "Trending", icon: "lightning" },
  { key: "new", label: "New pairs", icon: "sparkle" },
  { key: "migrated", label: "Graduated", icon: "checkmark" },
] as const;
const FEATURED = ["GLD", "CL", "HG", "DAYTONA"] as const;

export default function MarketsDashboard() {
  const [activeTab, setActiveTab] = useState(0);
  const [search, setSearch] = useState("");
  const [sort, setSort] =
    useState<NonNullable<MarketsQuery["sort"]>>("vol_desc");
  const [page, setPage] = useState(1);
  const [clock, setClock] = useState<number | null>(null);
  const stats = useQuery({ queryKey: ["stats"], queryFn: fetchStats });
  const commodities = useQuery({
    queryKey: ["commodities"],
    queryFn: fetchCommodities,
  });
  const payouts = useQuery({
    queryKey: ["recent-payouts", 4],
    queryFn: () => fetchRecentPayouts(4),
    refetchInterval: 30_000,
  });
  const markets = useQuery({
    queryKey: ["markets", "agentic", TABS[activeTab].key, search, sort, page],
    queryFn: () =>
      fetchMarkets({
        tab: TABS[activeTab].key,
        q: search || undefined,
        sort,
        page,
        pageSize: 8,
      }),
  });
  useEffect(() => {
    setClock(Date.now());
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = clock ? 900 - (Math.floor(clock / 1000) % 900) : null;
  const countdown =
    seconds === null
      ? "—"
      : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const total = markets.data?.total ?? 0;
  const rows = markets.data?.markets ?? [];
  const pages = Math.max(1, Math.ceil(total / 8));
  const s = stats.data;

  return (
    <>
      <div className={styles.pageHeading}>
        <div>
          <span className={styles.eyebrow}>The exchange</span>
          <h1>Markets</h1>
          <p>
            Discover markets paired with real commodities. Hold a token, earn
            its rewards.
          </p>
        </div>
        <Button href="/launch">
          <Icon name="plus" />
          Launch a market
        </Button>
      </div>
      {stats.isError ? (
        <ErrorState
          retry={() => stats.refetch()}
          message="Market overview is unavailable."
        />
      ) : (
        <section
          className={`${styles.stats} ice-capped`}
          aria-label="Exchange overview"
        >
          <Stat
            label="Total markets"
            value={s?.marketsCount.toLocaleString("en-US")}
            note={`${s?.commoditiesCount ?? "—"} commodity coins`}
            icon="load-balancer-classic"
          />
          <Stat
            label="24h trading volume"
            value={s && compact(s.volume24hUsd)}
            note="Across all markets"
            icon="transfer"
          />
          <Stat
            label="Total value locked"
            value={s && compact(s.valueLockedUsd)}
            note="Liquidity in the exchange"
            icon="gem"
          />
          <Stat
            label="Holder rewards · 24h"
            value={s && compact(s.paidToHolders24hUsd)}
            note="Paid in commodity coins"
            icon="money"
            reward
          />
        </section>
      )}
      <section
        className={styles.commoditySection}
        aria-labelledby="commodities-title"
      >
        <div className={styles.sectionHeader}>
          <h2 id="commodities-title">
            Commodities at a glance <span className={styles.period}>24H</span>
          </h2>
          <Link href="/commodities" className={styles.textLink}>
            View all commodities <Icon name="chevron-right" size={14} />
          </Link>
        </div>
        {commodities.isError ? (
          <ErrorState
            message="Commodity prices are unavailable."
            retry={() => commodities.refetch()}
          />
        ) : (
          <div className={styles.commodityGrid}>
            {FEATURED.map((symbol) => {
              const c = commodities.data?.find((c) => c.symbol === symbol);
              return (
                <Link
                  href={`/commodities/${symbol}`}
                  key={symbol}
                  className={styles.commodityCard}
                >
                  <div className={styles.commodityTop}>
                    <span className={styles.coinIcon}>
                      <CommodityLogo symbol={symbol} size={28} />
                    </span>
                    <span>
                      <strong>{c?.displayName ?? c?.name ?? symbol}</strong>
                      <small>{symbol}</small>
                    </span>
                    <Icon
                      name="chevron-right"
                      size={14}
                      className={styles.cardArrow}
                    />
                  </div>
                  <div className={styles.commodityPrice}>
                    <span>{c ? fmtPriceUsd(c.priceUsd) : "—"}</span>
                    {c && <Change value={c.change24h} />}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
      <section className={styles.marketSection} aria-labelledby="markets-title">
        <div className={styles.sectionHeader}>
          <h2 id="markets-title">
            Explore markets <span className={styles.count}>{total}</span>
          </h2>
          <span className={styles.subtle}>Find your next pair</span>
        </div>
        <div className={styles.toolbar}>
          <TabGroup
            ariaLabel="Market filters"
            style="rounded"
            activeIndex={activeTab}
            onChange={(index) => {
              setActiveTab(index);
              setPage(1);
              setSort(
                index === 0 ? "vol_desc" : index === 1 ? "new" : "mcap_desc",
              );
            }}
          >
            {TABS.map((tab) => (
              <Tab key={tab.key} leadIcon={<Icon name={tab.icon} size={14} />}>
                {tab.label}
              </Tab>
            ))}
          </TabGroup>
          <div className={styles.tableControls}>
            <SearchField
                aria-label="Search markets"
                type="search"
                placeholder="Search markets…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            <Select
              aria-label="Sort markets"
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as typeof sort);
                setPage(1);
              }}
            >
              <option value="vol_desc">Highest volume</option>
              <option value="mcap_desc">Highest market cap</option>
              <option value="mcap_asc">Lowest market cap</option>
              <option value="new">Newest first</option>
            </Select>
          </div>
        </div>
        <div className={`${styles.tableFrame} ice-capped`}>
          <div className={styles.tableScroll}>
            <table className={styles.table} aria-label="Markets">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Paired with</th>
                  <th className={styles.numeric}>Market cap</th>
                  <th className={styles.numeric}>24h change</th>
                  <th>Bonding curve</th>
                  <th className={styles.numeric}>Holder rewards · 24h</th>
                </tr>
              </thead>
              <tbody>
                {markets.isLoading ? (
                  Array.from({ length: 8 }, (_, i) => (
                    <tr key={i}>
                      <td colSpan={6}>
                        <div className={styles.skeleton} />
                      </td>
                    </tr>
                  ))
                ) : markets.isError ? (
                  <tr>
                    <td colSpan={6}>
                      <ErrorState
                        message="Markets could not be loaded."
                        retry={() => markets.refetch()}
                      />
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <div className={styles.empty}>
                        <Icon name="search" size={24} />
                        <h3>No markets found</h3>
                        <p>Try another ticker, market name, or commodity.</p>
                        <Button
                          outline
                          onClick={() => {
                            setSearch("");
                            setActiveTab(0);
                            setPage(1);
                          }}
                        >
                          Clear filters
                        </Button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  rows.map((m) => <MarketRow key={m.mint} market={m} />)
                )}
              </tbody>
            </table>
          </div>
          <div className={styles.pagination}>
            <span aria-live="polite">
              {markets.isLoading
                ? "Loading markets…"
                : `Showing ${total ? (page - 1) * 8 + 1 : 0}–${Math.min(page * 8, total)} of ${total} markets`}
            </span>
            <div>
              <Button
                outline
                size="sm"
                aria-label="Previous page"
                disabled={page === 1 || markets.isLoading}
                onClick={() => setPage((p) => p - 1)}
              >
                <Icon name="chevron-left" size={14} />
              </Button>
              <span>
                {page} / {pages}
              </span>
              <Button
                outline
                size="sm"
                aria-label="Next page"
                disabled={page >= pages || markets.isLoading}
                onClick={() => setPage((p) => p + 1)}
              >
                <Icon name="chevron-right" size={14} />
              </Button>
            </div>
          </div>
        </div>
      </section>
      <div className={styles.bottomGrid}>
        <section
          className={`${styles.panel} ice-capped`}
          aria-labelledby="rewards-title"
        >
          <div className={styles.panelHeading}>
            <h2 id="rewards-title">Holder rewards</h2>
            <span className={styles.rewardBadge}>
              Next payout <span>{countdown}</span>
            </span>
          </div>
          <p className={styles.panelDescription}>
            A share of every trade, delivered to holders.
          </p>
          {payouts.isError ? (
            <ErrorState
              message="Recent rewards are unavailable."
              retry={() => payouts.refetch()}
            />
          ) : (
            <ul className={styles.payouts}>
              {payouts.data?.map((p) => (
                <li key={p.id}>
                  <span className={styles.payoutIcon}>
                    <Icon name="arrow-up" size={16} />
                  </span>
                  <span>
                    <strong>
                      {shortenAddress(p.wallet)} <span>received</span>{" "}
                      {fmtAmount(p.amount)} {p.commoditySymbol}
                    </strong>
                    <small>
                      From <Link href={`/token/${p.mint}`}>{p.ticker}</Link>
                    </small>
                  </span>
                  <time>{clock ? timeAgo(p.ts * 1000) : "—"}</time>
                </li>
              ))}
            </ul>
          )}
          <Link className={styles.panelLink} href="/rewards">
            Explore rewards <Icon name="chevron-right" size={14} />
          </Link>
        </section>
        <section
          className={`${styles.panel} ice-capped`}
          aria-labelledby="fees-title"
        >
          <div className={styles.panelHeading}>
            <h2 id="fees-title">Every trade gives back.</h2>
            <Icon name="transfer" size={20} />
          </div>
          <p className={styles.panelDescription}>
            40% of every trading fee goes straight to holders.
            <br />
            Paid in the paired commodity, every 15 minutes.
          </p>
          <div
            className={styles.feeBar}
            role="img"
            aria-label="Fee split: 40% holders, 20% ICE buyback, 20% protocol, 20% Meteora"
          >
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className={styles.feeLegend}>
            {[
              ["Holders", "40%"],
              ["ICE buyback", "20%"],
              ["Protocol", "20%"],
              ["Meteora", "20%"],
            ].map(([label, value], i) => (
              <div key={label}>
                <span className={styles.feeKey} data-tone={i} />
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <div className={styles.iceStrip}>
            <span className={styles.iceIcon}>ICE</span>
            <span>
              <strong>The exchange coin</strong>
              <small>
                {s
                  ? `${compact(s.iceBurned).replace("$", "")} ICE burned`
                  : "—"}
              </small>
            </span>
            <Link href="/docs#fees" className={styles.textLink}>
              How it works <Icon name="chevron-right" size={14} />
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  note,
  icon,
  reward,
}: {
  label: string;
  value?: string;
  note: string;
  icon: string;
  reward?: boolean;
}) {
  return (
    <div className={styles.stat}>
      <div>
        <span className={styles.eyebrow}>{label}</span>
        <Icon name={icon} size={16} />
      </div>
      <strong className={reward ? styles.rewardValue : ""}>
        {value ?? "—"}
      </strong>
      <small>
        {reward && <span className={styles.dot} />}
        {note}
      </small>
    </div>
  );
}
function Change({ value }: { value: number }) {
  return (
    <span className={value >= 0 ? styles.positive : styles.negative}>
      {signed(value, 2)}%
    </span>
  );
}
function ErrorState({
  message,
  retry,
}: {
  message: string;
  retry: () => void;
}) {
  return (
    <div className={styles.empty} role="alert">
      <p>{message}</p>
      <Button outline size="sm" onClick={retry}>
        Try again
      </Button>
    </div>
  );
}
function MarketRow({ market: m }: { market: Market }) {
  const progress = Math.max(0, Math.min(100, m.curveProgressPct));
  return (
    <tr>
      <td>
        <Link href={`/token/${m.mint}`} className={styles.marketIdentity}>
          <span className={styles.marketAvatar}>{m.ticker.slice(0, 2)}</span>
          <span>
            <strong>{m.ticker}</strong>
            <small>{m.name}</small>
          </span>
        </Link>
      </td>
      <td>
        <Link
          href={`/commodities/${m.commoditySymbol}`}
          className={styles.pair}
        >
          <CommodityLogo symbol={m.commoditySymbol} size={18} />
          <span>{m.commoditySymbol}</span>
        </Link>
      </td>
      <td className={styles.numeric}>{compact(m.fdvUsd)}</td>
      <td className={styles.numeric}>
        <Change value={m.change24h} />
      </td>
      <td>
        {m.migrated ? (
          <span className={styles.graduated}>
            <Icon name="checkmark" size={12} />
            Graduated
          </span>
        ) : (
          <div className={styles.curve}>
            <ProgressBar
              total={20}
              filled={Math.round(progress / 5)}
              height={16}
            />
            <span>{Math.round(progress)}%</span>
          </div>
        )}
      </td>
      <td className={styles.numeric}>
        <span className={styles.earnings}>
          {fmtAmount(m.holderEarningsCoin)}
        </span>{" "}
        <span className={styles.earningsSymbol}>{m.commoditySymbol}</span>
      </td>
    </tr>
  );
}
