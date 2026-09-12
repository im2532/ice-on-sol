// Shared motion constants for motion/react transitions.
// CSS equivalents live in globals.css under "Motion Tokens".
// Full documentation: .ai/motion-rules.md

/** Strong ease-out — enter/exit, user-initiated actions, shared element transitions */
export const EASE_OUT_EXPO = [0.19, 1, 0.22, 1] as const;

/** Symmetric ease — on-screen morph/reposition (element stays visible) */
export const EASE_IN_OUT_QUART = [0.76, 0, 0.24, 1] as const;

/** Press micro-feedback, magnetic snap (seconds) */
export const DURATION_PRESS = 0.15;

/** Hover transitions, post-drag programmatic updates (seconds) */
export const DURATION_HOVER = 0.2;

/** Enter/exit animations, shared element transitions (seconds) */
export const DURATION_ENTER = 0.3;

/** Stagger delay between large items like cards (seconds) */
export const STAGGER_CARDS = 0.12;

/** Stagger delay between small items like segments, list rows (seconds) */
export const STAGGER_ITEMS = 0.04;
