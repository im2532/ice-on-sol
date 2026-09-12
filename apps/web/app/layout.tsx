import type { Metadata } from "next";
import { JetBrains_Mono, Geist } from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";
import localFont from "next/font/local";
import SiteChrome from "@/components/SiteChrome";
import "@/components/agentic/tokens.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});
const agenticMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});
const newYork = localFont({
  src: [
    {
      path: "../components/agentic/fonts/NewYorkLarge-Regular.otf",
      weight: "400",
    },
    {
      path: "../components/agentic/fonts/NewYorkLarge-Medium.otf",
      weight: "500",
    },
    {
      path: "../components/agentic/fonts/NewYorkLarge-Bold.otf",
      weight: "700",
    },
  ],
  variable: "--font-new-york-large",
  display: "swap",
});
const departure = localFont({
  src: "../components/agentic/fonts/DepartureMono-Regular.otf",
  weight: "400",
  variable: "--font-departure-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ICEmarkets — Commodity Market Exchange",
  description:
    "Launch a token paired with gold, crude, wheat, a Dragon Lore or a Daytona — any of 93 commodity coins. 40% of every trading fee is paid to holders in that commodity, every fifteen minutes, with nothing to claim.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${agenticMono.variable} ${newYork.variable} ${departure.variable}`}
    >
      <body className="flex min-h-screen flex-col bg-ground text-text antialiased">
        <Providers>
          <SiteChrome
            agenticFonts={`${geist.variable} ${agenticMono.variable} ${newYork.variable} ${departure.variable}`}
          >
            {children}
          </SiteChrome>
        </Providers>
      </body>
    </html>
  );
}
