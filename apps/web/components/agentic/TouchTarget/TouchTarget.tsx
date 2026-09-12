// app/components/TouchTarget/TouchTarget.tsx
// Expands the interactive hit area of small elements to a minimum of 44x44px (WCAG 2.5.5).
// The expansion is invisible and only active on coarse pointer devices (touch screens).
// On fine pointer devices (mouse/trackpad), the expansion is hidden.
//
// Usage:
//   <TouchTarget>
//     <button className={styles.smallIconBtn}>
//       <Icon name="close" />
//     </button>
//   </TouchTarget>
//
// Or as a wrapper around any interactive child:
//   <button className={styles.smallIconBtn}>
//     <TouchTarget.Expand />
//     <Icon name="close" />
//   </button>

import React from "react";
import styles from "./TouchTarget.module.css";

interface TouchTargetProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Wraps children with a relative container and adds an invisible
 * 44x44px touch expansion area.
 */
export function TouchTarget({ children, className }: TouchTargetProps) {
  return (
    <span className={`${styles.wrapper} ${className ?? ""}`}>
      {children}
      <span className={styles.expand} aria-hidden="true" />
    </span>
  );
}

/**
 * Standalone expansion element — place inside any relatively-positioned
 * interactive element to expand its hit area to 44x44px.
 */
TouchTarget.Expand = function TouchTargetExpand() {
  return <span className={styles.expand} aria-hidden="true" />;
};
