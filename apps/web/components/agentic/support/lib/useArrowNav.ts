// src/lib/useArrowNav.ts
// Arrow-key navigation hook for menus, toolbars, tab lists, and any list of focusable items.
// Supports vertical, horizontal, and both orientations.
// Home/End keys jump to first/last item. Wrapping is configurable.
// No external dependencies.

import { useRef, useCallback, useEffect } from "react";

type Orientation = "vertical" | "horizontal" | "both";

interface UseArrowNavOptions {
  /** Navigation axis. Default: "vertical". */
  orientation?: Orientation;
  /** Wrap around at edges. Default: false. */
  wrap?: boolean;
  /** Custom CSS selector for navigable items. Default: direct children with tabIndex >= 0. */
  selector?: string;
}

interface ArrowNavAPI {
  /** Ref to attach to the container element. */
  ref: React.RefCallback<HTMLElement>;
  /** Manually destroy listeners (also happens on unmount). */
  destroy: () => void;
}

export function useArrowNav(options: UseArrowNavOptions = {}): ArrowNavAPI {
  const { orientation = "vertical", wrap = false, selector } = options;

  const containerRef = useRef<HTMLElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const getItems = useCallback((): HTMLElement[] => {
    if (!containerRef.current) return [];
    if (selector) {
      return Array.from(containerRef.current.querySelectorAll<HTMLElement>(selector));
    }
    return Array.from(containerRef.current.children).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child.tabIndex >= 0 && child.offsetParent !== null
    );
  }, [selector]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const key = e.key;
      const items = getItems();
      if (!items.length) return;

      let forward: string | null = null;
      let backward: string | null = null;

      if (orientation === "vertical") {
        forward = "ArrowDown";
        backward = "ArrowUp";
      } else if (orientation === "horizontal") {
        forward = "ArrowRight";
        backward = "ArrowLeft";
      } else {
        // both
        if (key === "ArrowDown" || key === "ArrowRight") forward = key;
        else if (key === "ArrowUp" || key === "ArrowLeft") backward = key;
        if (!forward && !backward) return;
      }

      if (key !== forward && key !== backward && key !== "Home" && key !== "End") return;

      e.preventDefault();

      const currentIndex = items.indexOf(document.activeElement as HTMLElement);
      let nextIndex: number;

      if (key === "Home") {
        nextIndex = 0;
      } else if (key === "End") {
        nextIndex = items.length - 1;
      } else if (key === forward) {
        if (currentIndex < 0) nextIndex = 0;
        else if (currentIndex >= items.length - 1) nextIndex = wrap ? 0 : items.length - 1;
        else nextIndex = currentIndex + 1;
      } else {
        // backward
        if (currentIndex < 0) nextIndex = items.length - 1;
        else if (currentIndex <= 0) nextIndex = wrap ? items.length - 1 : 0;
        else nextIndex = currentIndex - 1;
      }

      items[nextIndex!]?.focus();
    },
    [getItems, orientation, wrap]
  );

  const setup = useCallback(
    (node: HTMLElement) => {
      node.addEventListener("keydown", handleKeyDown);
      cleanupRef.current = () => {
        node.removeEventListener("keydown", handleKeyDown);
      };
    },
    [handleKeyDown]
  );

  const destroy = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
  }, []);

  const ref = useCallback(
    (node: HTMLElement | null) => {
      // Cleanup previous
      cleanupRef.current?.();
      cleanupRef.current = null;
      containerRef.current = node;

      if (node) setup(node);
    },
    [setup]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  return { ref, destroy };
}
