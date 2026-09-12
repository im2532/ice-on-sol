// src/lib/springs.ts
// Named spring presets for interactive components.
// Import from here — never hardcode stiffness/damping in component files.

export const springs = {
  // Snappy: button feedback, tab indicators, micro-interactions
  snappy: {
    type:      "spring" as const,
    stiffness: 500,
    damping:   30,
    mass:      1,
  },

  // Standard: default for most enter animations (modal, card, popover)
  standard: {
    type:      "spring" as const,
    stiffness: 300,
    damping:   28,
    mass:      1,
  },

  // Gentle: large panels, drawers, sidebars
  gentle: {
    type:      "spring" as const,
    stiffness: 200,
    damping:   26,
    mass:      1,
  },

  // Clean: layout animations — no overshoot, predictable settling
  clean: {
    type:      "spring" as const,
    stiffness: 400,
    damping:   40,
    mass:      1,
  },
} as const;

export type SpringPresetKey = keyof typeof springs;
