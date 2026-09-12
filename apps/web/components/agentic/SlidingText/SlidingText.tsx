// Subtle text bump animation for live-updating values.
// The whole text nudges down slightly and fades, then snaps back with the new value.

'use client';

import { useRef, useEffect, useState } from 'react';
import { motion, useSpring, useTransform } from 'motion/react';
import styles from './SlidingText.module.css';

interface SlidingTextProps {
  /** The text to display */
  children: string;
  /** Additional CSS class applied to the outer wrapper */
  className?: string;
}

export function SlidingText({ children, className }: SlidingTextProps) {
  const prevRef = useRef(children);
  const [bumping, setBumping] = useState(false);
  const bump = useSpring(0, { stiffness: 600, damping: 50 });
  const opacity = useTransform(bump, [0, 1], [1, 0.6]);

  useEffect(() => {
    if (children !== prevRef.current) {
      prevRef.current = children;
      bump.set(1);
      setBumping(true);
      const timeout = setTimeout(() => {
        bump.set(0);
        setBumping(false);
      }, 60);
      return () => clearTimeout(timeout);
    }
  }, [children, bump]);

  return (
    <motion.span
      className={`${styles.wrapper} ${className ?? ''}`}
      style={{ opacity }}
    >
      {children}
    </motion.span>
  );
}
