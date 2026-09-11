import type { Metadata } from "next";
import { Sora, Manrope, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";
import Nav from "@/components/Nav";
import MobileNav from "@/components/MobileNav";
import Footer from "@/components/Footer";
import Aurora from "@/components/Aurora";

const sora = Sora({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display", display: "swap" });
const manrope = Manrope({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-body", display: "swap" });
const jbMono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "ICEmarkets — Commodity Market Exchange",
  description:
    "Launch a token paired with gold, crude, wheat, a Dragon Lore or a Daytona — any of 93 commodity coins. 40% of every trading fee is paid to holders in that commodity, every fifteen minutes, with nothing to claim.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sora.variable} ${manrope.variable} ${jbMono.variable}`}>
      <body className="flex min-h-screen flex-col bg-ground text-text antialiased">
        <Aurora />
        <Providers>
          <Nav />
          <main className="relative z-10 flex-1">{children}</main>
          <Footer />
          <MobileNav />
        </Providers>
      </body>
    </html>
  );
}
