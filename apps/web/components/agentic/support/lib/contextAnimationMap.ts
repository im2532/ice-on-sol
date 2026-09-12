// src/lib/contextAnimationMap.ts
// Context-aware animation overrides.
// The same component needs different animations depending on where it's deployed.
//
// Usage: When a component receives a `context` prop or when Claude detects
// the deployment context from the prompt, this map overrides the default
// Component × Trigger → Preset lookup.

import type { MotionPresetKey } from "./motionPresets";

export type AnimationContext =
  | "in-list"           // card/item is one of N siblings — stagger applies
  | "standalone-modal"  // rendered in isolation, demands full focus
  | "in-hero"           // viewport-triggered scroll reveal
  | "in-form"           // inside a form — subdued, no spatial motion
  | "in-sidebar"        // inside a re-docking panel
  | "toast-stack"       // notification at viewport edge
  | "drag-reorder"      // sortable list — layout prop only, no variants
  | "content-replace";  // AI swapping content in place — opacity crossfade only

export interface ContextAnimationConfig {
  mount?:          MotionPresetKey;
  unmount?:        MotionPresetKey;
  hover?:          MotionPresetKey;
  tap?:            MotionPresetKey;
  parentWrapper?:  MotionPresetKey;
  triggerMode:     "immediate" | "whileInView" | "state-driven";
  viewportMargin?: string;
}

export const contextAnimationMap: Record<AnimationContext, ContextAnimationConfig> = {

  "in-list": {
    mount:         "enter-fade-up",
    unmount:       "exit-fade",
    hover:         "hover-lift",
    tap:           "press-scale",
    parentWrapper: "stagger-children",
    triggerMode:   "immediate",
  },

  "standalone-modal": {
    mount:       "enter-scale-spring",
    unmount:     "exit-scale-down",
    triggerMode: "immediate",
  },

  "in-hero": {
    mount:          "enter-fade-up",
    triggerMode:    "whileInView",
    viewportMargin: "-100px",
  },

  "in-form": {
    mount:       "enter-fade",          // opacity only — no spatial motion in forms
    hover:       "state-change-color",
    tap:         "press-scale",
    triggerMode: "immediate",
  },

  "in-sidebar": {
    mount:       "enter-slide-right",
    unmount:     "enter-slide-right",   // same preset — standard easing, re-dock rule
    triggerMode: "immediate",
  },

  "toast-stack": {
    mount:       "enter-slide-top",
    unmount:     "exit-fade",
    tap:         "press-scale",
    triggerMode: "immediate",
  },

  "drag-reorder": {
    // No explicit preset — use Framer Motion `layout` prop + AnimatePresence only
    triggerMode: "immediate",
  },

  "content-replace": {
    mount:       "enter-fade",
    unmount:     "exit-fade",
    triggerMode: "state-driven",
  },
};
