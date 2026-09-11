"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActive } from "./Nav";

const ICON = {
  markets: <path d="M4 19h16M6 15l4-5 3 3 5-7" />,
  commodities: <path d="M12 3v18M5 8l7 4 7-4M5 16l7 4 7-4" />,
  rewards: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  docs: <path d="M4 6h16M4 12h16M4 18h10" />,
};

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Bottom glass bar (≤768px) with the gradient Launch button in the middle, per Phone.dc.html. */
export default function MobileNav() {
  const pathname = usePathname() ?? "/";

  const item = (href: string, label: string, icon: React.ReactNode) => {
    const on = isActive(pathname, href);
    return (
      <Link
        key={href}
        href={href}
        aria-current={on ? "page" : undefined}
        className={`tap flex flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-semibold ${
          on ? "text-text" : "text-muted"
        }`}
      >
        <Icon>{icon}</Icon>
        {label}
      </Link>
    );
  };

  return (
    <nav
      aria-label="Primary"
      className="glass-strong fixed inset-x-4 bottom-[22px] z-40 flex items-center px-1.5 md:hidden"
      style={{ height: 64, borderRadius: 22 }}
    >
      {item("/", "Markets", ICON.markets)}
      {item("/commodities", "Commodities", ICON.commodities)}

      <Link
        href="/launch"
        aria-label="Launch a market"
        aria-current={isActive(pathname, "/launch") ? "page" : undefined}
        className="flex flex-1 items-center justify-center"
      >
        <span
          className="grid h-11 w-11 place-items-center rounded-[14px] bg-ice-gradient-diag"
          style={{ boxShadow: "0 8px 24px rgba(153,69,255,0.4)" }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#05060B"
            strokeWidth="2.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </span>
      </Link>

      {item("/rewards", "Rewards", ICON.rewards)}
      {item("/docs", "Docs", ICON.docs)}
    </nav>
  );
}
