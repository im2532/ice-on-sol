"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "./Mark";
import ConnectButton from "./ConnectButton";

export const NAV_LINKS = [
  { href: "/", label: "Markets" },
  { href: "/commodities", label: "Commodities" },
  { href: "/launch", label: "Launch" },
  { href: "/rewards", label: "Rewards" },
  { href: "/docs", label: "Docs" },
] as const;

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Floating glass-strong bar on the shared 1280px measure; links hide below md for the bottom bar. */
export default function Nav() {
  const pathname = usePathname() ?? "/";

  return (
    <header className="container-x relative z-30 pt-[18px]">
      {/* Desktop: the floating bar from the mockups. */}
      <nav
        aria-label="Primary"
        className="glass-strong hidden items-center justify-between gap-4 py-0 pl-[18px] pr-3 md:flex"
        style={{ height: 60, borderRadius: 18 }}
      >
        <Link href="/" aria-label="ICEmarkets home" className="shrink-0 rounded">
          <Logo />
        </Link>

        <ul className="flex items-center gap-1">
          {NAV_LINKS.map((l) => {
            const on = isActive(pathname, l.href);
            return (
              <li key={l.href}>
                <Link
                  href={l.href}
                  aria-current={on ? "page" : undefined}
                  className={`tab ${on ? "tab-on" : ""}`}
                >
                  {l.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="flex shrink-0 items-center gap-2">
          <ConnectButton />
          <a
            href="https://x.com/launchonicemarkets"
            target="_blank"
            rel="noreferrer noopener"
            aria-label="ICEmarkets on X"
            className="btn-ghost tap grid place-items-center"
            style={{ height: 38, width: 38, padding: 0, borderRadius: 12 }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.9 2H22l-7.6 8.7L23.3 22h-7.1l-5.6-6.7L4.2 22H1l8.1-9.3L1 2h7.3l5 6.2L18.9 2Zm-1.2 18h1.9L7.4 4H5.3l12.4 16Z" />
            </svg>
          </a>
        </div>
      </nav>

      {/* Mobile: mark + wallet chip only; navigation lives in the bottom bar. */}
      <div className="flex items-center justify-between md:hidden">
        <Link href="/" aria-label="ICEmarkets home" className="rounded">
          <Logo size={26} textSize={15} />
        </Link>
        <ConnectButton />
      </div>
    </header>
  );
}
