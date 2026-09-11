import type { Metadata } from "next";
import Link from "next/link";
import { FEE_SPLIT_BPS, LAUNCH, PAYOUT, PROGRAM_IDS } from "@icemarkets/registry";

export const metadata: Metadata = { title: "Docs — ICEmarkets" };

const SECTIONS = [
  { id: "launch", label: "Launch" },
  { id: "curve", label: "Curve" },
  { id: "commodity-coins", label: "Commodity coins & peg" },
  { id: "fees", label: "Fees & rewards" },
  { id: "staleness", label: "Staleness & halts" },
  { id: "risks", label: "Risks & disclosures" },
  { id: "contracts", label: "Contracts" },
];

export default function DocsPage() {
  return (
    <div className="container-x pb-16 pt-8 md:pt-12">
      <header className="flex flex-col gap-3">
        <span className="eyebrow">Docs</span>
        <h1 className="display text-[32px] font-bold leading-tight text-white md:text-[44px]">
          How it works.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-body">
          ICEmarkets lets anyone launch a memecoin paired with a commodity coin instead of SOL. Every trade
          pays a fee in that commodity coin, and 40% of it goes straight to holders. This page explains the
          mechanics, the risks, and where the contracts live.
        </p>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[200px_1fr] lg:gap-10">
        <nav aria-label="Docs sections" className="hidden lg:block">
          <ul className="sticky top-6 flex flex-col gap-0.5">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="tap block rounded-lg px-3 py-2 text-sm text-muted hover:bg-white/[0.05] hover:text-text">
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-col gap-4">
          <Section id="launch" title="Launch">
            <p>
              Every market opens with a fixed supply of {LAUNCH.totalSupply.toLocaleString("en-US")} tokens,
              all of it seeded into a Meteora Dynamic Bonding Curve pool quoted in the commodity coin you
              pick. The curve runs from a ${LAUNCH.initialMarketCapUsd.toLocaleString("en-US")} opening cap to
              a ${LAUNCH.migrationMarketCapUsd.toLocaleString("en-US")} migration cap, with{" "}
              {LAUNCH.percentageSupplyOnMigration}% of supply reserved above it so the pool keeps quoting with
              no cliff. You pick the trading fee (1/2/3%) and make a first buy of at least $
              {LAUNCH.minFirstBuyUsd} — everything lands in one on-chain transaction for a USDC or COIN first
              buy (two for SOL, since it routes through Jupiter first).
            </p>
          </Section>

          <Section id="curve" title="Curve">
            <p>
              The bonding curve is a real Meteora DBC pool, tradable by any terminal or router from block one
              — Jupiter, Axiom, Photon and GMGN all index it automatically. A market shows{" "}
              <strong className="font-semibold text-text">% of curve</strong> until it fills; then it migrates
              permissionlessly to a Meteora DAMM v2 pool at the same price and reads{" "}
              <strong className="font-semibold text-text">Graduated</strong>. Trading pauses only for the
              seconds between curve completion and the migration landing.
            </p>
          </Section>

          <Section id="commodity-coins" title="Commodity coins & peg">
            <p>
              A commodity coin (GLD, HG, RSGP, DAYTONA, …) is not backed by a warehouse of gold or a vault of
              skins — it is a protocol-minted token whose price is enforced by an oracle feed and a reserve of
              USDC. Buying mints new coins at the oracle price plus a small spread; selling burns coins and
              pays out from the reserve. The protocol is structurally short every coin it issues, which is why
              supply is capped per coin and the reserve ratio is watched continuously.
            </p>
          </Section>

          <Section id="fees" title="Fees & rewards">
            <p>
              Of the 80% of gross trading fees ICEmarkets keeps after Meteora&apos;s fixed 20% cut,{" "}
              {FEE_SPLIT_BPS.holders / 100}% (40% of gross) goes to holders of that specific market — paid
              automatically in the commodity coin, weighted by balance, roughly every{" "}
              {PAYOUT.cycleSec / 60} minutes. The rest splits {FEE_SPLIT_BPS.buyback / 100}% (20% of gross)
              into buying back and burning $ICE, and {FEE_SPLIT_BPS.protocol / 100}% (20% of gross) to the
              protocol treasury. There is no creator share. Payouts go straight to wallets that already hold
              the coin; everything else accrues into a Merkle epoch you can claim any time from{" "}
              <Link href="/rewards" className="link">
                Rewards
              </Link>
              .
            </p>
          </Section>

          <Section id="staleness" title="Staleness & halts">
            <p>
              Every commodity has a maximum oracle age. If the feed goes stale — a market closes for the
              weekend, a data vendor drops — the market shows{" "}
              <span className="text-negative">
                &ldquo;A current price is unavailable. Market value will return when the price feed
                recovers.&rdquo;
              </span>{" "}
              Some tiers allow sell-only trading at a wider spread while stale so holders can always exit;
              others halt entirely until the feed recovers.
            </p>
          </Section>

          <Section id="risks" title="Risks & disclosures">
            <ul className="flex list-disc flex-col gap-2 pl-5">
              <li>
                ICEmarkets coins are synthetic. They track a commodity&apos;s price via an oracle and are not
                a claim on any physical asset — redemption is only ever against the protocol&apos;s USDC
                reserve, which can be exhausted.
              </li>
              <li>Trading may be halted at any time if a price feed becomes unreliable or stale.</li>
              <li>
                Smart-contract risk applies to every program in the stack, including third-party programs
                (Meteora DBC / DAMM v2) ICEmarkets does not control.
              </li>
              <li>
                ICEmarkets is not available to persons in the United States, the United Kingdom, or any
                sanctioned jurisdiction. Nothing on this site is investment, legal, or tax advice.
              </li>
            </ul>
          </Section>

          <Section id="contracts" title="Contracts">
            <div className="-mx-5 overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[480px] border-collapse">
                <thead>
                  <tr>
                    <th className="th">Program</th>
                    <th className="th">Address</th>
                  </tr>
                </thead>
                <tbody className="mono">
                  {Object.entries(PROGRAM_IDS).map(([name, addr]) => (
                    <tr key={name}>
                      <td className="td capitalize text-muted">{name.replace(/([A-Z])/g, " $1")}</td>
                      <td className="td text-xs">{addr}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-muted">
              Placeholders until mainnet deploy — packages/registry/src/programs.ts and docs/CONTRACTS.md are
              the source of truth.
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="glass scroll-mt-6 p-5 sm:px-[22px]">
      <h2 className="display mb-3 text-lg font-semibold">{title}</h2>
      <div className="flex flex-col gap-3 text-sm leading-relaxed text-body">{children}</div>
    </section>
  );
}
