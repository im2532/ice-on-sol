// Source: https://www.figma.com/design/FLribGjjakpYvdwuBTGTvD/AGENTIC-DESIGN-SYSTEM--v1.2-?node-id=4056-1461
// Extracted: 2026-04-05
// Tokens: color-bg-secondary, space-2, space-4, radius-sm, radius-md, radius-full

"use client";

import React, { useState, useId, forwardRef } from "react";
import { LayoutGroup } from "motion/react";
import styles from "./TabGroup.module.css";

type TabGroupStyle = "pill" | "segmented" | "underline" | "rounded";

interface TabGroupProps {
  ariaLabel?: string;
  /** Visual style variant */
  style: TabGroupStyle;
  /** Whether the group stretches to fill parent width */
  fullWidth?: boolean;
  /** Controlled active tab index */
  activeIndex?: number;
  /** Uncontrolled: initial active tab index (default: 0) */
  defaultIndex?: number;
  /** Called when active tab changes */
  onChange?: (index: number) => void;
  /** Tab items */
  children: React.ReactNode;
  /** Additional CSS class */
  className?: string;
}

export const TabGroup = forwardRef<HTMLDivElement, TabGroupProps>(
  function TabGroup(
    {
      style,
      ariaLabel = "Tabs",
      fullWidth = false,
      activeIndex,
      defaultIndex = 0,
      onChange,
      children,
      className,
    },
    ref,
  ) {
    const [internalIndex, setInternalIndex] = useState(defaultIndex);
    const currentIndex =
      activeIndex !== undefined ? activeIndex : internalIndex;
    const groupId = useId();

    const handleTabClick = (index: number) => {
      if (activeIndex === undefined) {
        setInternalIndex(index);
      }
      onChange?.(index);
    };

    const clonedChildren = React.Children.map(children, (child, index) => {
      if (!React.isValidElement(child)) return child;
      return React.cloneElement(
        child as React.ReactElement<Record<string, unknown>>,
        {
          active: index === currentIndex,
          onClick: () => handleTabClick(index),
          _groupId: groupId,
        },
      );
    });

    return (
      <LayoutGroup id={groupId}>
        <div
          ref={ref}
          role="tablist"
          aria-label={ariaLabel}
          onKeyDown={(event) => {
            const tabs = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                '[role="tab"]:not([aria-disabled="true"])',
              ),
            );
            const index = tabs.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            if (
              index < 0 ||
              !["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)
            )
              return;
            event.preventDefault();
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? tabs.length - 1
                  : (index +
                      (event.key === "ArrowRight" ? 1 : -1) +
                      tabs.length) %
                    tabs.length;
            tabs[next]?.focus();
            tabs[next]?.click();
          }}
          className={`${styles.tabGroup} ${styles[style]} ${fullWidth ? styles.fullWidth : ""} ${className ?? ""}`}
        >
          {clonedChildren}
        </div>
      </LayoutGroup>
    );
  },
);
