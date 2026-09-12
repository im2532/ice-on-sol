// src/tokens/motion.ts
// Three-tier motion token hierarchy — W3C DTCG-aligned
// $type: "duration" | "cubicBezier"
//
// RULE: Components reference Semantic (Tier 2). Semantic references Primitive (Tier 1).
//       Nothing in a component file should reference Tier 1 directly.

// ─── Tier 1: Primitives ────────────────────────────────────────────────────
export const motionDuration = {
  instant:   0,     // ms — no animation; instant state swap
  micro:     70,    // ms — button state, toggle (IBM fast-01)
  quick:     100,   // ms — tooltip, micro-fade (IBM fast-02)
  base:      150,   // ms — small expansion, exit baseline
  moderate:  240,   // ms — dropdown, toast (IBM moderate-02)
  standard:  300,   // ms — default enter; most content panels
  slow:      500,   // ms — page transitions, large reveals
  glacial:   700,   // ms — background dimming (IBM slow-02)
} as const;

export const motionEasing = {
  // Primitive curves — W3C cubicBezier format [P1x, P1y, P2x, P2y]
  linear:        [0, 0, 1, 1]              as const,
  easeIn:        [0.4, 0, 1, 1]            as const, // M1 Accelerate — permanent exits
  easeOut:       [0, 0, 0.2, 1]            as const, // M1 Decelerate — enters
  easeInOut:     [0.4, 0, 0.2, 1]          as const, // M1 Standard — on-screen movement
  spring:        [0.34, 1.56, 0.64, 1]     as const, // Overshoot — playful emphasis
  springClean:   [0.175, 0.885, 0.32, 1.275] as const, // Subtle overshoot
  emphasized:    [0.05, 0.7, 0.1, 1.0]     as const, // M3 Emphasized Decelerate (enter)
  emphasizedOut: [0.3, 0.0, 0.8, 0.15]     as const, // M3 Emphasized Accelerate (exit)
  productive:    [0.2, 0, 0.38, 0.9]       as const, // IBM Carbon productive standard
  standard:      [0.4, 0, 0.6, 1]          as const, // Sharp — temporary exit / re-dock
} as const;

// ─── Tier 2: Semantic ─────────────────────────────────────────────────────
// Named by intent, not raw value. Always reference these in components.
export const semanticMotion = {
  feedback: {
    // Button hover, press, toggle — ultra-fast, direct manipulation
    duration: motionDuration.micro,    // 70ms
    ease:     motionEasing.easeOut,
  },
  enter: {
    // Default mount for content, panels, overlays
    duration: motionDuration.standard, // 300ms
    ease:     motionEasing.easeOut,
  },
  exit: {
    // Default unmount — always shorter than enter
    duration: motionDuration.base,     // 150ms
    ease:     motionEasing.easeIn,
  },
  expand: {
    // Accordion, collapsible — spring for natural height
    duration: motionDuration.moderate, // 240ms
    ease:     motionEasing.spring,
  },
  collapse: {
    duration: motionDuration.base,     // 150ms
    ease:     motionEasing.easeIn,
  },
  redock: {
    // Sidebar/panel that re-docks nearby — IBM Carbon rule
    // Uses standard easing (decelerates to stop), NOT exit easing
    duration: motionDuration.moderate, // 240ms
    ease:     motionEasing.standard,
  },
  pageTransition: {
    duration: motionDuration.slow,     // 500ms
    ease:     motionEasing.easeInOut,
  },
  overlay: {
    // Background dimming behind modals/drawers
    duration: motionDuration.glacial,  // 700ms
    ease:     motionEasing.easeOut,
  },
} as const;

// ─── Tier 3: Component-specific ────────────────────────────────────────────
// Reference semantic, not primitives. Override only when a component
// genuinely needs to deviate from the semantic default.
export const componentMotion = {
  button: {
    hover: semanticMotion.feedback,
    press: semanticMotion.feedback,
  },
  modal: {
    enter: { duration: 250, ease: motionEasing.emphasized },
    exit:  { duration: 200, ease: motionEasing.emphasizedOut },
  },
  dropdown: {
    open:  { duration: motionDuration.moderate, ease: motionEasing.easeOut },
    close: { duration: motionDuration.quick, ease: motionEasing.easeIn },
  },
  toast: {
    enter: { duration: motionDuration.moderate, ease: motionEasing.easeOut },
    exit:  { duration: motionDuration.base, ease: motionEasing.easeIn },
  },
  sidebar: {
    open:  semanticMotion.redock,
    close: semanticMotion.redock,
  },
  tooltip: {
    enter: { duration: motionDuration.quick, ease: motionEasing.easeOut },
    exit:  { duration: 75, ease: motionEasing.easeIn },
  },
} as const;

// ─── Type exports ──────────────────────────────────────────────────────────
export type MotionDurationKey = keyof typeof motionDuration;
export type MotionEasingKey   = keyof typeof motionEasing;
export type SemanticMotionKey = keyof typeof semanticMotion;
