// app/components/VirtualScroller/VirtualScroller.tsx
// Renders only visible items in long scrollable lists for performance.
// Fixed item height — no variable-height support (keeps implementation simple and fast).
//
// Usage:
//   <VirtualScroller
//     items={agents}
//     itemHeight={48}
//     containerHeight={400}
//     renderItem={(agent, index) => <AgentRow key={agent.id} agent={agent} />}
//   />

"use client";

import React, { useRef, useState, useCallback, useEffect } from "react";
import styles from "./VirtualScroller.module.css";

interface VirtualScrollerProps<T> {
  /** Data array to render. */
  items: T[];
  /** Fixed height of each item in px. */
  itemHeight: number;
  /** Height of the scrollable container in px. */
  containerHeight: number;
  /** Render function for each item. */
  renderItem: (item: T, index: number) => React.ReactNode;
  /** Extra items to render above/below viewport for smoother scrolling. Default: 5. */
  overscan?: number;
  /** Additional className for the container. */
  className?: string;
}

export function VirtualScroller<T>({
  items,
  itemHeight,
  containerHeight,
  renderItem,
  overscan = 5,
  className,
}: VirtualScrollerProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const totalHeight = items.length * itemHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(
    items.length,
    Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
  );

  const visibleItems = items.slice(startIndex, endIndex);
  const offsetY = startIndex * itemHeight;

  const handleScroll = useCallback(() => {
    if (containerRef.current) {
      setScrollTop(containerRef.current.scrollTop);
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  return (
    <div
      ref={containerRef}
      className={`${styles.container} ${className ?? ""}`}
      style={{ height: containerHeight }}
    >
      <div className={styles.spacer} style={{ height: totalHeight }}>
        <div
          className={styles.viewport}
          style={{ transform: `translateY(${offsetY}px)` }}
        >
          {visibleItems.map((item, i) => (
            <div
              key={startIndex + i}
              className={styles.item}
              style={{ height: itemHeight }}
            >
              {renderItem(item, startIndex + i)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
