"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Mascot from "./Mascot";
import ConnectButton from "./ConnectButton";

const LINKS = [
  { href: "/", label: "Markets" },
  { href: "/commodities", label: "Commodities" },
  { href: "/launch", label: "Launch" },
  { href: "/rewards", label: "Rewards" },
  { href: "/docs", label: "Docs" },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-bg/85 backdrop-blur">
      <nav
        aria-label="Primary"
        className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6"
      >
        <Link href="/" className="flex shrink-0 items-center gap-2 icemarkets-focus rounded" aria-label="ICEmarkets home">
          <Mascot size={28} />
          <span className="text-sm font-bold leading-none tracking-wide">
            ICEmarkets
            <span className="block text-[9px] font-medium leading-none text-muted">
              COMMODITY MARKET EXCHANGE
            </span>
          </span>
        </Link>

        <ul className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <li key={l.href}>
                <Link
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  className={`icemarkets-focus rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    active ? "bg-positive/10 text-positive" : "text-muted hover:text-text"
                  }`}
                >
                  {l.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center gap-2">
          <ConnectButton />
          <a
            href="https://x.com/launchonicemarkets"
            target="_blank"
            rel="noreferrer noopener"
            aria-label="ICEmarkets on X"
            className="icemarkets-btn-secondary icemarkets-focus grid h-9 w-9 place-items-center rounded-lg"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.9 2H22l-7.6 8.7L23.3 22h-7.1l-5.6-6.7L4.2 22H1l8.1-9.3L1 2h7.3l5 6.2L18.9 2Zm-1.2 18h1.9L7.4 4H5.3l12.4 16Z" />
            </svg>
          </a>
        </div>
      </nav>
      <div className="flex gap-1 overflow-x-auto border-t border-border/60 px-4 py-1.5 md:hidden scrollbar-thin">
        {LINKS.map((l) => {
          const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`icemarkets-focus shrink-0 rounded-md px-3 py-1.5 text-xs font-medium ${
                active ? "bg-positive/10 text-positive" : "text-muted"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </div>
    </header>
  );
}
