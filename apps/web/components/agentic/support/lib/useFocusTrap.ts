// src/lib/useFocusTrap.ts
// Focus trapping hook for modals, dialogs, drawers, and panels.
// Traps Tab key within a container, handles Escape, returns focus on deactivate.
// No external dependencies.

import { useRef, useCallback, useEffect } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null
  );
}

interface UseFocusTrapOptions {
  /** Called when Escape is pressed inside the trap. */
  onEscape?: () => void;
  /** Auto-focus the first focusable element on activate. Default: true. */
  autoFocus?: boolean;
  /** Return focus to the previously focused element on deactivate. Default: true. */
  returnFocus?: boolean;
}

interface FocusTrapAPI {
  /** Ref to attach to the container element. */
  ref: React.RefCallback<HTMLElement>;
  /** Activate the focus trap. */
  activate: () => void;
  /** Deactivate the focus trap. */
  deactivate: () => void;
  /** Whether the trap is currently active. */
  isActive: boolean;
}

export function useFocusTrap(options: UseFocusTrapOptions = {}): FocusTrapAPI {
  const { onEscape, autoFocus = true, returnFocus = true } = options;

  const containerRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const activeRef = useRef(false);

  // Store latest onEscape in a ref to avoid re-binding listeners
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!activeRef.current || !containerRef.current) return;

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onEscapeRef.current?.();
      return;
    }

    if (e.key === "Tab") {
      const focusable = getFocusableElements(containerRef.current);
      if (!focusable.length) {
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first || !containerRef.current.contains(document.activeElement)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last || !containerRef.current.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  }, []);

  const handleFocusOut = useCallback(() => {
    if (!activeRef.current || !containerRef.current) return;
    setTimeout(() => {
      if (activeRef.current && containerRef.current && !containerRef.current.contains(document.activeElement)) {
        const focusable = getFocusableElements(containerRef.current);
        if (focusable.length) focusable[0].focus();
      }
    }, 0);
  }, []);

  const activate = useCallback(() => {
    if (activeRef.current) return;
    activeRef.current = true;
    previousFocusRef.current = document.activeElement as HTMLElement;

    document.addEventListener("keydown", handleKeyDown, true);
    containerRef.current?.addEventListener("focusout", handleFocusOut);

    if (autoFocus && containerRef.current) {
      const autofocusEl = containerRef.current.querySelector<HTMLElement>("[autofocus]");
      if (autofocusEl) {
        autofocusEl.focus();
      } else {
        const focusable = getFocusableElements(containerRef.current);
        if (focusable.length) focusable[0].focus();
      }
    }
  }, [autoFocus, handleKeyDown, handleFocusOut]);

  const deactivate = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;

    document.removeEventListener("keydown", handleKeyDown, true);
    containerRef.current?.removeEventListener("focusout", handleFocusOut);

    if (returnFocus && previousFocusRef.current?.focus) {
      previousFocusRef.current.focus();
    }
    previousFocusRef.current = null;
  }, [returnFocus, handleKeyDown, handleFocusOut]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (activeRef.current) {
        document.removeEventListener("keydown", handleKeyDown, true);
        containerRef.current?.removeEventListener("focusout", handleFocusOut);
      }
    };
  }, [handleKeyDown, handleFocusOut]);

  const ref = useCallback((node: HTMLElement | null) => {
    containerRef.current = node;
  }, []);

  return {
    ref,
    activate,
    deactivate,
    get isActive() { return activeRef.current; },
  };
}
