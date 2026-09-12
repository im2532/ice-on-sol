'use client';

import { type ReactNode, forwardRef } from 'react';
import { Icon } from '../Icon/Icon';
import styles from './Navigation.module.css';

interface NavigationProps {
  /** Navigation body content — NavLink, NavSection, etc. */
  children: ReactNode;
  /** User display name shown in the footer greeting */
  userName?: string;
  /** Layout variant: classic (flat or sectioned) vs tree (hierarchical) */
  variant?: 'classic' | 'tree';
  /** Additional CSS class for the outer nav element */
  className?: string;
  /** Callback when the sidebar toggle button is clicked */
  onToggle?: () => void;
  /** Callback when the user overflow menu is clicked */
  onUserMenu?: () => void;
}

export const Navigation = forwardRef<HTMLElement, NavigationProps>(
  function Navigation({
    children,
    userName = 'Alex',
    variant = 'classic',
    className,
    onToggle,
    onUserMenu,
  }, ref) {
    return (
      <nav ref={ref} className={`${styles.navigation} ${className ?? ''}`}>
        {/* Logo header */}
        <div className={styles.logo}>
          <div className={styles.logoContainer}>
            <span
              className={styles.logoWordmark}
              role="img"
              aria-label="Agentic UI"
            />
            <button
              className={styles.menuToggle}
              onClick={onToggle}
              aria-label="Toggle navigation"
              type="button"
            >
              <Icon name="menu-open" size={16} />
            </button>
          </div>
        </div>

        {/* Scrollable nav body */}
        <div
          className={`${styles.body} ${variant === 'tree' ? styles.bodyTree : ''}`}
        >
          {children}
        </div>

        {/* User footer */}
        <div className={styles.footer}>
          <div className={styles.userSettings}>
            <span className={styles.userName}>Hi, {userName}</span>
            <button
              className={styles.overflowButton}
              onClick={onUserMenu}
              aria-label="User menu"
              type="button"
            >
              <Icon name="overflow-menu-vertical" size={16} />
            </button>
          </div>
        </div>
      </nav>
    );
  }
);
