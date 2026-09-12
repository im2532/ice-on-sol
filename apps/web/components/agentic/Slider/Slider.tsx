// Source: https://www.figma.com/design/FLribGjjakpYvdwuBTGTvD/AGENTIC-DESIGN-SYSTEM--v1.2-?node-id=4074-1001
// Extracted: 2026-04-05
// Tokens: color-bg-primary, color-bg-tertiary, color-content-icon,
//         color-border-subtle, radius-sm, space-2, space-16

'use client';

import { useState, useRef, useCallback, forwardRef } from 'react';
import { motion } from 'motion/react';
import { SlidingText } from '@/components/agentic/SlidingText';
import { EASE_OUT_EXPO, DURATION_ENTER, DURATION_HOVER, DURATION_PRESS } from '@/components/agentic/motion';
import styles from './Slider.module.css';

export type SliderSize = 'sm' | 'lg';

export interface SliderProps {
  /** Current value as a percentage (0–100). Controlled mode. */
  value?: number;
  /** Initial value for uncontrolled mode (0–100) */
  defaultValue?: number;
  /** Called when value changes (drag or click) */
  onChange?: (value: number) => void;
  /** Snap increment in percentage points (e.g. 10 = snap every 10%). Omit for continuous. */
  step?: number;
  /** Display size: sm (32px) or lg (48px) */
  size?: SliderSize;
  /** Show percentage label on the right */
  showLabel?: boolean;
  /** Scale labels below the slider */
  scaleLabels?: string[];
  /** Animate fill on mount */
  animated?: boolean;
  /** Delay before mount animation starts (seconds) */
  animationDelay?: number;
  /** Whether the slider is disabled */
  disabled?: boolean;
  className?: string;
}

const SIZE_CLASSES: Record<SliderSize, string> = {
  sm: styles.trackSm,
  lg: styles.trackLg,
};

function snapValue(raw: number, step: number | undefined): number {
  if (!step) return raw;
  return Math.round(raw / step) * step;
}

export const Slider = forwardRef<HTMLDivElement, SliderProps>(
  function Slider({
    value: controlledValue,
    defaultValue = 0,
    onChange,
    step,
    size = 'sm',
    showLabel = false,
    scaleLabels,
    animated = false,
    animationDelay = 0,
    disabled = false,
    className,
  }, ref) {
    const [internalValue, setInternalValue] = useState(defaultValue);
    const currentValue = controlledValue !== undefined ? controlledValue : internalValue;
    const clamped = Math.max(0, Math.min(100, currentValue));
    const trackRef = useRef<HTMLDivElement>(null);
    const [dragging, setDragging] = useState(false);
    const [hasInteracted, setHasInteracted] = useState(false);

    const mergedTrackRef = useCallback(
      (node: HTMLDivElement | null) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (trackRef as any).current = node;
        if (typeof ref === 'function') {
          ref(node);
        } else if (ref) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (ref as any).current = node;
        }
      },
      [ref],
    );

    const updateFromPointer = useCallback((clientX: number) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const raw = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
      const next = snapValue(Math.round(raw), step);
      if (controlledValue === undefined) {
        setInternalValue(next);
      }
      onChange?.(next);
    }, [controlledValue, onChange, step]);

    const handlePointerDown = useCallback((e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      setHasInteracted(true);
      setDragging(true);
      updateFromPointer(e.clientX);
    }, [updateFromPointer]);

    const handlePointerMove = useCallback((e: React.PointerEvent) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      updateFromPointer(e.clientX);
    }, [updateFromPointer]);

    const handlePointerUp = useCallback(() => {
      setDragging(false);
    }, []);

    // Transition strategy:
    // - Dragging with step: short magnetic snap (DURATION_PRESS, EASE_OUT_EXPO)
    // - Dragging without step: duration 0 — follow cursor exactly
    // - Mount animation: entrance ease with delay
    // - After interaction, not dragging: fast snap
    const fillTransition = dragging
      ? step
        ? { duration: DURATION_PRESS, ease: EASE_OUT_EXPO }
        : { duration: 0 }
      : !hasInteracted && animated
        ? { delay: animationDelay, duration: DURATION_ENTER * 1.5, ease: EASE_OUT_EXPO }
        : { duration: DURATION_HOVER, ease: EASE_OUT_EXPO };

    return (
      <div className={`${styles.slider} ${className ?? ''}`}>
        {scaleLabels && (
          <div className={styles.scaleLabels}>
            {scaleLabels.map((label, i) => (
              <span key={i} className={styles.scaleLabel}>{label}</span>
            ))}
          </div>
        )}
        <div
          ref={mergedTrackRef}
          className={`${styles.track} ${SIZE_CLASSES[size]} ${dragging ? styles.trackDragging : ''} ${disabled ? styles.trackDisabled : ''}`}
          onPointerDown={disabled ? undefined : handlePointerDown}
          onPointerMove={disabled ? undefined : handlePointerMove}
          onPointerUp={disabled ? undefined : handlePointerUp}
          role="slider"
          aria-valuenow={clamped}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${clamped}%`}
          aria-disabled={disabled || undefined}
          tabIndex={disabled ? -1 : 0}
          style={disabled ? { pointerEvents: 'none' } : undefined}
        >
          {step && (
            <div className={styles.snapDots}>
              {Array.from({ length: Math.floor(100 / step) - 1 }, (_, i) => {
                const pct = (i + 1) * step;
                if (pct === clamped) return null;
                return (
                  <span
                    key={pct}
                    className={styles.snapDot}
                    style={{ left: `${pct}%`, transform: 'translateX(-50%)' }}
                  />
                );
              })}
            </div>
          )}
          <motion.div
            className={styles.fill}
            initial={animated ? { width: '0%' } : false}
            animate={{ width: `${clamped}%` }}
            transition={fillTransition}
          >
            <div className={styles.handle}>
              <span className={styles.handleLine} />
            </div>
          </motion.div>
          {showLabel && (
            <span className={styles.valueLabel}>
              <SlidingText>{`${clamped}%`}</SlidingText>
            </span>
          )}
        </div>
      </div>
    );
  }
);
