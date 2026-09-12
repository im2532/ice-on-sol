// Source: https://www.figma.com/design/FLribGjjakpYvdwuBTGTvD/AGENTIC-DESIGN-SYSTEM--v1.2-?node-id=4072-7707
// Extracted: 2026-04-05
// Tokens: color-bg-success, color-bg-disabled, space-2

'use client';

import { motion } from 'motion/react';
import { EASE_OUT_EXPO } from '@/components/agentic/motion';
import styles from './ProgressBar.module.css';

export interface ProgressBarProps {
  /** Total number of segments */
  total: number;
  /** Number of filled (completed) segments */
  filled: number;
  /** Height of the bar in pixels */
  height?: number;
  /** Animate segments filling in on mount */
  animated?: boolean;
  /** Delay before animation starts (seconds) */
  animationDelay?: number;
  className?: string;
}

export function ProgressBar({
  total,
  filled,
  height = 24,
  animated = false,
  animationDelay = 0,
  className,
}: ProgressBarProps) {
  const segments = Array.from({ length: total }, (_, i) => i < filled);

  return (
    <div
      className={`${styles.bar} ${className ?? ''}`}
      style={{ height }}
      role="progressbar"
      aria-valuenow={filled}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-label={`${filled} of ${total}`}
    >
      {segments.map((isFilled, i) =>
        animated && isFilled ? (
          <motion.div
            key={i}
            className={styles.segmentFilled}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{
              delay: animationDelay + i * 0.04,
              duration: 0.25,
              ease: EASE_OUT_EXPO,
            }}
            style={{ transformOrigin: 'left' }}
          />
        ) : (
          <div
            key={i}
            className={isFilled ? styles.segmentFilled : styles.segmentEmpty}
          />
        )
      )}
    </div>
  );
}
