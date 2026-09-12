// src/lib/motionPresets.ts
// Flat Framer Motion variant registry.
// Claude imports from this file exclusively — hardcoded values are never acceptable.

import type { Variants, Transition } from "motion/react";
import { semanticMotion, motionEasing } from "@/components/agentic/support/tokens/motion";

export interface MotionPreset {
  variants: Variants;
  transition: Transition;
  properties?: string[];  // GPU-safe properties that animate
  intent?: string;        // Human-readable — Claude reads this to select the right preset
}

const s = semanticMotion;

export const motionPresets = {

  // ═══════════════════════════════════════════════════
  // ENTER ANIMATIONS
  // ═══════════════════════════════════════════════════

  "enter-fade-up": {
    variants: {
      hidden:  { opacity: 0, y: 8 },
      visible: { opacity: 1, y: 0 },
    },
    transition: { duration: s.enter.duration / 1000, ease: s.enter.ease },
    properties: ["opacity", "transform"],
    intent: "Default mount for cards, list items, content panels. Use whileInView for off-screen reveals.",
  },

  "enter-fade": {
    variants: {
      hidden:  { opacity: 0 },
      visible: { opacity: 1 },
    },
    transition: { duration: s.enter.duration / 1000, ease: s.enter.ease },
    properties: ["opacity"],
    intent: "Tooltip, overlay, subtle content appear. Opacity-only — safest for reduced motion.",
  },

  "enter-scale-spring": {
    variants: {
      hidden:  { opacity: 0, scale: 0.95 },
      visible: { opacity: 1, scale: 1 },
    },
    transition: { type: "spring", stiffness: 300, damping: 24 },
    properties: ["opacity", "transform"],
    intent: "Modal, dialog, popover — prominent container entrance. Spring for natural deceleration.",
  },

  "enter-slide-right": {
    variants: {
      hidden:  { opacity: 0, x: "100%" },
      visible: { opacity: 1, x: 0 },
    },
    transition: { type: "spring", stiffness: 280, damping: 28 },
    properties: ["opacity", "transform"],
    intent: "Sidebar, drawer opening from right edge. Spring for physical panel feel.",
  },

  "enter-slide-top": {
    variants: {
      hidden:  { opacity: 0, y: "-100%" },
      visible: { opacity: 1, y: 0 },
    },
    transition: { duration: s.enter.duration / 1000, ease: s.enter.ease },
    properties: ["opacity", "transform"],
    intent: "Toast/notification sliding down from top of viewport.",
  },

  // ═══════════════════════════════════════════════════
  // EXIT ANIMATIONS
  // ═══════════════════════════════════════════════════

  "exit-fade": {
    variants: {
      visible: { opacity: 1 },
      hidden:  { opacity: 0 },
    },
    transition: { duration: s.exit.duration / 1000, ease: s.exit.ease },
    properties: ["opacity"],
    intent: "Generic exit — tooltip, overlay removal. Fast, opacity-only.",
  },

  "exit-fade-down": {
    variants: {
      visible: { opacity: 1, y: 0 },
      hidden:  { opacity: 0, y: 8 },
    },
    transition: { duration: s.exit.duration / 1000, ease: s.exit.ease },
    properties: ["opacity", "transform"],
    intent: "Reverse of enter-fade-up. Exit toward origin point.",
  },

  "exit-scale-down": {
    variants: {
      visible: { opacity: 1, scale: 1 },
      hidden:  { opacity: 0, scale: 0.95 },
    },
    transition: { duration: s.exit.duration / 1000, ease: s.exit.ease },
    properties: ["opacity", "transform"],
    intent: "Modal/dialog closing — mirrors enter-scale-spring.",
  },

  // ═══════════════════════════════════════════════════
  // HOVER & INTERACTIVE FEEDBACK
  // ═══════════════════════════════════════════════════

  "hover-lift": {
    variants: {
      rest:    { y: 0 },
      hovered: { y: -2 },
    },
    transition: { duration: s.feedback.duration / 1000, ease: s.feedback.ease },
    properties: ["transform"],
    intent: "Cards with hover elevation. Pair with CSS box-shadow transition for shadow change.",
  },

  "hover-scale": {
    variants: {
      rest:    { scale: 1 },
      hovered: { scale: 1.03 },
    },
    transition: { type: "spring", stiffness: 400, damping: 25 },
    properties: ["transform"],
    intent: "Interactive thumbnails, icon buttons, small action surfaces.",
  },

  "press-scale": {
    variants: {
      rest:    { scale: 1 },
      pressed: { scale: 0.97 },
    },
    transition: { duration: 0.07, ease: [0.4, 0, 1, 1] as const },
    properties: ["transform"],
    intent: "Button tap feedback — haptic-like scale down on press.",
  },

  // ═══════════════════════════════════════════════════
  // EXPAND / COLLAPSE
  // ═══════════════════════════════════════════════════

  "expand-height": {
    variants: {
      collapsed: { height: 0, opacity: 0 },
      expanded:  { height: "auto", opacity: 1 },
    },
    transition: { duration: s.expand.duration / 1000, ease: [0.4, 0, 0.2, 1] as const },
    properties: ["height", "opacity"],
    intent: "Accordion, collapsible panel. Pair with overflow: hidden on the wrapper.",
  },

  // ═══════════════════════════════════════════════════
  // STATE CHANGE
  // ═══════════════════════════════════════════════════

  "state-change-color": {
    variants: {
      default:  { backgroundColor: "var(--color-surface)" },
      selected: { backgroundColor: "var(--color-surface-selected)" },
      active:   { backgroundColor: "var(--color-surface-active)" },
    },
    transition: { duration: s.feedback.duration / 1000, ease: s.feedback.ease },
    properties: ["background-color"],
    intent: "Tab selection, nav active state, dropdown item hover. No transform — background/color only.",
  },

  // ═══════════════════════════════════════════════════
  // STAGGER PARENT
  // ═══════════════════════════════════════════════════

  "stagger-children": {
    variants: {
      hidden:  { opacity: 0 },
      visible: {
        opacity: 1,
        transition: {
          staggerChildren: 0.05,  // 50ms between each child
          delayChildren:   0.1,   // 100ms before first child animates
        },
      },
    },
    transition: {},
    intent: "Parent wrapper for list/grid of children. Always pair with enter-fade-up on each child. Cap: 10 items max at 50ms stagger (500ms total).",
  },

} satisfies Record<string, MotionPreset>;

export type MotionPresetKey = keyof typeof motionPresets;
