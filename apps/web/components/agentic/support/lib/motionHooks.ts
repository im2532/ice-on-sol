// src/lib/motionHooks.ts
// Composable animation hooks for the design system.
// These abstract Framer Motion API complexity behind intent-driven interfaces.

import { useReducedMotion } from "motion/react";
import { motionPresets, type MotionPresetKey } from "./motionPresets";
import {
  contextAnimationMap,
  type AnimationContext,
} from "./contextAnimationMap";

// ─── useMotionPreset ───────────────────────────────────────────────────────
// Returns the full Framer Motion props for a given preset key.
// Spreads directly onto a <motion.div>.
//
// Usage:
//   const props = useMotionPreset("enter-fade-up");
//   <motion.div {...props}>content</motion.div>

export function useMotionPreset(key: MotionPresetKey) {
  const preset = motionPresets[key];

  return {
    variants: preset.variants,
    initial: "hidden",
    animate: "visible",
    exit: "hidden",
    transition: preset.transition,
  };
}

// ─── useContextAnimation ───────────────────────────────────────────────────
// Returns animation props appropriate for a specific deployment context.
// Handles whileInView, stagger parent detection, and context overrides.
//
// Usage:
//   const { itemProps, parentProps } = useContextAnimation("in-list");
//   <motion.ul {...parentProps}>
//     {items.map(i => <motion.li key={i.id} {...itemProps}>...</motion.li>)}
//   </motion.ul>

export function useContextAnimation(context: AnimationContext) {
  const config = contextAnimationMap[context];

  // Build item-level props
  const itemProps: Record<string, unknown> = {};

  if (config.mount) {
    const mountPreset = motionPresets[config.mount];
    itemProps.variants = mountPreset.variants;
    itemProps.transition = mountPreset.transition;

    if (config.triggerMode === "whileInView") {
      itemProps.initial = "hidden";
      itemProps.whileInView = "visible";
      itemProps.viewport = {
        once: true,
        margin: config.viewportMargin ?? "-100px",
      };
    } else {
      itemProps.initial = "hidden";
      itemProps.animate = "visible";
    }
  }

  if (config.unmount) {
    const exitPreset = motionPresets[config.unmount];
    itemProps.exit =
      "hidden" in exitPreset.variants
        ? exitPreset.variants.hidden
        : { opacity: 0 };
  }

  if (config.hover) {
    const hoverPreset = motionPresets[config.hover];
    const hoverVariant =
      "hovered" in hoverPreset.variants
        ? hoverPreset.variants.hovered
        : "selected" in hoverPreset.variants
          ? hoverPreset.variants.selected
          : undefined;
    if (hoverVariant) {
      itemProps.whileHover = hoverVariant;
    }
  }

  if (config.tap) {
    const tapPreset = motionPresets[config.tap];
    const tapVariant =
      "pressed" in tapPreset.variants ? tapPreset.variants.pressed : undefined;
    if (tapVariant) {
      itemProps.whileTap = tapVariant;
    }
  }

  // Build parent-level props (for stagger)
  const parentProps: Record<string, unknown> = {};

  if (config.parentWrapper) {
    const parentPreset = motionPresets[config.parentWrapper];
    parentProps.variants = parentPreset.variants;
    parentProps.initial = "hidden";
    parentProps.animate = "visible";
  }

  return { itemProps, parentProps };
}

// ─── useReducedMotionSafe ──────────────────────────────────────────────────
// Wraps useReducedMotion with a fallback for components that need
// custom behavior beyond the global MotionConfig reducedMotion="user".
//
// Returns a function that selects between full and reduced animation objects.
//
// Usage:
//   const pick = useReducedMotionSafe();
//   const animate = pick(
//     { x: 0 },           // full motion
//     { opacity: 1 }      // reduced motion fallback
//   );

export function useReducedMotionSafe() {
  const shouldReduce = useReducedMotion();

  return function pick<T>(full: T, reduced: T): T {
    return shouldReduce ? reduced : full;
  };
}
