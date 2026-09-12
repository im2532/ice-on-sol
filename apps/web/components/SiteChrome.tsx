"use client";
import TosModal from "./TosModal";
import { Toaster } from "./Toast";
import { MotionConfig } from "motion/react";
import AppShell from "./layout/AppShell";
import "./layout/pages.css";

export default function SiteChrome({
  children,
  agenticFonts,
}: {
  children: React.ReactNode;
  agenticFonts: string;
}) {
  return (
    <MotionConfig reducedMotion="user">
      <div className={`agentic-theme ${agenticFonts}`}>
        <AppShell>{children}</AppShell>
        <Toaster />
        <TosModal />
      </div>
    </MotionConfig>
  );
}
