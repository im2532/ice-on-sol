"use client";
// Adapted from beui.dev/components/motion/popover.

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  cloneElement,
  createContext,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type Ref,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { usePopoverPortalPosition } from "./popover-position";
import { EASE_OUT, SPRING_PANEL } from "@/lib/ease";
import { cn } from "@/lib/utils";

type Side = "top" | "bottom";
type Align = "start" | "end";
type MorphContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  triggerId: string;
  contentId: string;
  triggerRef: React.MutableRefObject<HTMLElement | null>;
  registerTrigger: (node: HTMLElement | null) => void;
  contentRef: React.MutableRefObject<HTMLDivElement | null>;
};

const MorphContext = createContext<MorphContextValue | null>(null);
function useMorphContext(component: string) {
  const context = useContext(MorphContext);
  if (!context) throw new Error(`${component} must be used within <MorphPopover>`);
  return context;
}

export function MorphPopover({
  children,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  className,
}: {
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const baseId = useId();
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (!controlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );
  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);
  const anchorRef = useMemo<React.MutableRefObject<HTMLElement | null>>(
    () => ({ current: trigger ?? root }),
    [root, trigger],
  );

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root?.contains(target) && !contentRef.current?.contains(target)) close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open, root, setOpen]);

  const value = useMemo(
    () => ({
      open,
      setOpen,
      toggle,
      triggerId: `${baseId}-trigger`,
      contentId: `${baseId}-content`,
      triggerRef: anchorRef,
      registerTrigger: setTrigger,
      contentRef,
    }),
    [anchorRef, baseId, open, setOpen, toggle],
  );
  return (
    <MorphContext.Provider value={value}>
      <div ref={setRoot} className={cn("relative inline-flex", className)}>{children}</div>
    </MorphContext.Provider>
  );
}

function mergeRefs<T>(...refs: Array<Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node);
      else if (ref && typeof ref === "object")
        (ref as React.MutableRefObject<T | null>).current = node;
    }
  };
}

export function MorphPopoverTrigger({ children }: { children: ReactElement }) {
  const context = useMorphContext("MorphPopoverTrigger");
  if (!isValidElement(children)) return children;
  const child = children as ReactElement<Record<string, unknown>>;
  const childOnClick = child.props.onClick as ((event: unknown) => void) | undefined;
  const childRef = (child.props as { ref?: Ref<HTMLElement> }).ref;
  return cloneElement(child, {
    id: context.triggerId,
    ref: mergeRefs(childRef, context.registerTrigger),
    onClick: (event: unknown) => {
      childOnClick?.(event);
      context.toggle();
    },
    "aria-haspopup": "dialog",
    "aria-expanded": context.open,
    "aria-controls": context.open ? context.contentId : undefined,
  });
}

function hiddenClip(side: Side, align: Align, radius: number) {
  return `inset(${side === "bottom" ? "0%" : "92%"} ${align === "end" ? "0%" : "92%"} ${side === "bottom" ? "92%" : "0%"} ${align === "end" ? "92%" : "0%"} round ${radius}px)`;
}

export function MorphPopoverContent({
  children,
  side = "bottom",
  align = "end",
  sideOffset = 8,
  radius = 14,
  className,
}: {
  children: ReactNode;
  side?: Side;
  align?: Align;
  sideOffset?: number;
  radius?: number;
  className?: string;
}) {
  const context = useMorphContext("MorphPopoverContent");
  const reduce = useReducedMotion() ?? false;
  const [portalReady, setPortalReady] = useState(false);
  const layout = usePopoverPortalPosition(
    context.triggerRef,
    context.contentRef,
    portalReady && context.open,
  );
  useEffect(() => setPortalReady(true), []);
  if (!portalReady) return null;
  const left = layout
    ? align === "end"
      ? layout.trigger.left + layout.trigger.width - layout.content.width
      : layout.trigger.left
    : 0;
  const top = layout
    ? side === "bottom"
      ? layout.trigger.top + layout.trigger.height + sideOffset
      : layout.trigger.top - layout.content.height - sideOffset
    : 0;

  return createPortal(
    <AnimatePresence>
      {context.open && (
        <motion.div
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
          transition={reduce ? { duration: 0.12 } : SPRING_PANEL}
          style={{
            left,
            top,
            visibility: layout ? "visible" : "hidden",
            transformOrigin: `${side === "bottom" ? "top" : "bottom"} ${align === "end" ? "right" : "left"}`,
          }}
          className="fixed z-[60] [filter:drop-shadow(0_10px_18px_rgba(18,57,78,0.16))]"
        >
          <motion.div
            ref={context.contentRef}
            id={context.contentId}
            role="dialog"
            aria-labelledby={context.triggerId}
            initial={reduce ? undefined : { clipPath: hiddenClip(side, align, radius) }}
            animate={{ clipPath: `inset(0% 0% 0% 0% round ${radius}px)` }}
            exit={reduce ? undefined : { clipPath: hiddenClip(side, align, radius) }}
            transition={reduce ? undefined : { duration: 0.32, ease: EASE_OUT }}
            style={{ borderRadius: radius }}
            className={cn("overflow-hidden border border-border bg-white", className)}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
