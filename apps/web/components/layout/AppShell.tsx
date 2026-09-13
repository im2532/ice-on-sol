"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Button } from "@/components/agentic/Button";
import { NavLink, NavSection } from "@/components/agentic/Navigation";
import { Icon } from "@/components/agentic/Icon/Icon";
import { CLUSTER } from "@/lib/cluster";
import { USE_MOCK } from "@/lib/api";
import { shortenAddress } from "@/lib/format";
import styles from "@/components/markets/MarketsDashboard.module.css";
import IceAtmosphere from "./IceAtmosphere";
const NAV = [
  { href: "/", label: "Markets", icon: "load-balancer-classic" },
  { href: "/commodities", label: "Commodities", icon: "gem" },
  { href: "/launch", label: "Launch", icon: "plus" },
  { href: "/rewards", label: "Rewards", icon: "money" },
];
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [mobileNav, setMobileNav] = useState(false);
  const { publicKey, connecting, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  useEffect(() => setMobileNav(false), [pathname]);
  const active = (href: string) =>
    href === "/"
      ? pathname === "/" || pathname.startsWith("/token/")
      : pathname === href || pathname.startsWith(href + "/");
  const title = pathname.startsWith("/token/")
    ? "Market details"
    : pathname.startsWith("/commodities/")
      ? "Commodity details"
      : pathname === "/docs"
        ? "Documentation"
        : pathname === "/restricted"
          ? "Availability"
          : (NAV.find((n) => active(n.href))?.label ?? "ICEmarkets");
  return (
    <div className={styles.shell}>
      <aside
        className={`${styles.sidebar} ${mobileNav ? styles.sidebarOpen : ""}`}
      >
        <Link href="/" className={styles.brand} aria-label="ICEmarkets home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.brandLogo} src="/brand/ice-on-solana.png" alt="ICE on Solana" width={940} height={343} />
        </Link>
        <span className={styles.workspaceLabel}>Commodity exchange</span>
        <nav aria-label="Primary" className={styles.navigation}>
          <NavSection label="Workspace">
            {NAV.map((n) => (
              <NavLink key={n.href} {...n} active={active(n.href)} />
            ))}
          </NavSection>
          <NavSection label="Resources" divider>
            <NavLink
              label="Documentation"
              icon="todo"
              href="/docs"
              active={active("/docs")}
            />
            <NavLink
              label="Community"
              icon="chat"
              href="https://x.com/launchonicemarkets"
            />
          </NavSection>
        </nav>
        <div className={styles.sidebarBottom}>
          <div className={styles.sidebarNote}>
            <Icon name="gem" size={20} />
            <h3>
              Real-world pairs.
              <br />A new kind of market.
            </h3>
            <p>Launch a token paired with your favorite commodity.</p>
            <Button outline fullWidth href="/launch" size="sm">
              Create a market <Icon name="plus" size={14} />
            </Button>
          </div>
          <div className={styles.network}>
            <span className={styles.dot} /> Solana {CLUSTER}{" "}
            <span className={styles.networkTag}>
              {CLUSTER === "mainnet-beta" ? "MAIN" : "DEV"}
            </span>
          </div>
        </div>
      </aside>
      <div className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.breadcrumb}>
            <Button
              plain
              className={styles.menuButton}
              aria-label="Toggle navigation"
              aria-expanded={mobileNav}
              onClick={() => setMobileNav(!mobileNav)}
            >
              <Icon name={mobileNav ? "close" : "menu-open"} />
            </Button>
            <span>Workspace</span>
            <Icon name="chevron-right" size={12} />
            <strong>{title}</strong>
          </div>
          <div className={styles.topActions}>
            <span className={styles.dataBadge}>
              <span className={styles.dot} />
              {USE_MOCK ? "Sample data" : "Live data"}
            </span>
            <Button
              outline
              onClick={() => (publicKey ? disconnect() : setVisible(true))}
              disabled={connecting}
              aria-label={publicKey ? "Disconnect wallet" : "Connect wallet"}
            >
              <Icon name="money" />
              {publicKey
                ? shortenAddress(publicKey.toBase58())
                : connecting
                  ? "Connecting…"
                  : "Connect wallet"}
            </Button>
          </div>
        </header>
        <IceAtmosphere />
        <main className={styles.content}>
          {children}{" "}
          <footer className={styles.footer}>
            <span>
              ICEmarkets <span>·</span> Built on Solana
            </span>
            <p>
              Commodity coins are synthetic and redeemable only against the
              protocol reserve. Trading may halt.
            </p>
            <Link href="/docs#risks">
              Risks & disclosures <Icon name="chevron-right" size={12} />
            </Link>
          </footer>
        </main>
      </div>
    </div>
  );
}
