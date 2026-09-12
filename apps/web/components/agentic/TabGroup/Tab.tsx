// Source: https://www.figma.com/design/FLribGjjakpYvdwuBTGTvD/AGENTIC-DESIGN-SYSTEM--v1.2-?node-id=4052-890
// Extracted: 2026-04-05
// Tokens: color-content-primary, color-content-secondary, color-content-icon,
//         font-label, text-button, weight-regular, leading-small, tracking-spacious

'use client';

import React from 'react';
import { motion } from 'motion/react';
import { EASE_OUT_EXPO } from '@/components/agentic/motion';
import styles from './TabGroup.module.css';

interface TabProps {
  /** Whether this tab is currently active */
  active?: boolean;
  /** Optional icon before the label */
  leadIcon?: React.ReactNode;
  /** Optional icon/badge after the label */
  tailIcon?: React.ReactNode;
  /** Tab label text */
  children: React.ReactNode;
  /** Click handler */
  onClick?: () => void;
  /** Whether the tab is disabled */
  disabled?: boolean;
  /** Additional CSS class */
  className?: string;
  /** @internal Injected by TabGroup for scoped layoutId */
  _groupId?: string;
}

export const Tab = React.forwardRef<HTMLButtonElement, TabProps>(
  function Tab({ active = false, leadIcon, tailIcon, children, onClick, disabled = false, className, _groupId }, ref) {
    return (
      <button
        ref={ref}
        role="tab"
        aria-selected={active}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : active ? 0 : -1}
        className={`${styles.tab} ${active ? styles.tabActive : ''} ${disabled ? styles.tabDisabled : ''} ${className ?? ''}`}
        onClick={disabled ? undefined : onClick}
      >
        {active && (
          <motion.span
            layoutId={`tab-indicator-${_groupId}`}
            className={styles.indicator}
            transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
          />
        )}
        {leadIcon && <span className={styles.leadIcon}>{leadIcon}</span>}
        <span className={styles.label}>{children}</span>
        {tailIcon && <span className={styles.tailIcon}>{tailIcon}</span>}
      </button>
    );
  }
);
