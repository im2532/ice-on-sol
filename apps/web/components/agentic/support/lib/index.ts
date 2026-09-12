// src/lib/index.ts
// Animation layer barrel export

export { motionPresets, type MotionPreset, type MotionPresetKey } from "./motionPresets";
export { contextAnimationMap, type AnimationContext, type ContextAnimationConfig } from "./contextAnimationMap";
export { springs, type SpringPresetKey } from "./springs";
export { useMotionPreset, useContextAnimation, useReducedMotionSafe } from "./motionHooks";
export { useFocusTrap } from "./useFocusTrap";
export { useArrowNav } from "./useArrowNav";
