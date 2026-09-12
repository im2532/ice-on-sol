// src/providers/MotionProvider.tsx
// Root animation provider — wrap in layout.tsx (Next.js) or App root.
//
// reducedMotion="user" automatically respects OS "Reduce Motion" preference:
// - Transform and layout animations are disabled
// - Opacity and color animations continue
// This single declaration replaces per-component useReducedMotion calls
// for standard cases.

import { MotionConfig } from "motion/react";

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      {children}
    </MotionConfig>
  );
}
