'use client';

import { forwardRef, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useFocusTrap } from '@/components/agentic/support/lib/useFocusTrap';
import { EASE_OUT_EXPO, DURATION_ENTER } from '@/components/agentic/motion';
import styles from './Dialog.module.css';

/* ---------------------------------------------------------------------------
   Dialog — modal overlay with focus trap, AnimatePresence enter/exit
   --------------------------------------------------------------------------- */
export type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  size?: DialogSize;
  children?: React.ReactNode;
  className?: string;
};

export function Dialog({
  open,
  onClose,
  size = 'md',
  children,
  className,
}: DialogProps) {
  const trap = useFocusTrap({
    onEscape: onClose,
    autoFocus: true,
    returnFocus: true,
  });

  const savedOverflowRef = useRef<string>('');

  // Activate/deactivate trap and manage body overflow
  useEffect(() => {
    if (open) {
      savedOverflowRef.current = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      // Small delay to ensure the DOM has rendered before activating
      const raf = requestAnimationFrame(() => {
        trap.activate();
      });
      return () => cancelAnimationFrame(raf);
    } else {
      trap.deactivate();
      document.body.style.overflow = savedOverflowRef.current;
    }
  }, [open, trap]);

  // Cleanup on unmount — restore overflow
  useEffect(() => {
    return () => {
      document.body.style.overflow = savedOverflowRef.current;
    };
  }, []);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only close if the click target is the backdrop itself, not the panel
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={styles.backdrop}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DURATION_ENTER * 0.5 }}
          onClick={handleBackdropClick}
        >
          <motion.div
            ref={trap.ref}
            role="dialog"
            aria-modal="true"
            className={[styles.panel, styles[size], className]
              .filter(Boolean)
              .join(' ')}
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{
              duration: DURATION_ENTER,
              ease: [...EASE_OUT_EXPO],
            }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------------------------------------------------------------------------
   DialogTitle — <h2> heading
   --------------------------------------------------------------------------- */
export type DialogTitleProps = React.HTMLAttributes<HTMLHeadingElement> & {
  className?: string;
};

export const DialogTitle = forwardRef<HTMLHeadingElement, DialogTitleProps>(
  function DialogTitle({ className, ...props }, ref) {
    return (
      <h2
        ref={ref}
        className={[styles.title, className].filter(Boolean).join(' ')}
        {...props}
      />
    );
  },
);

/* ---------------------------------------------------------------------------
   DialogDescription — <p> secondary color
   --------------------------------------------------------------------------- */
export type DialogDescriptionProps =
  React.HTMLAttributes<HTMLParagraphElement> & {
    className?: string;
  };

export const DialogDescription = forwardRef<
  HTMLParagraphElement,
  DialogDescriptionProps
>(function DialogDescription({ className, ...props }, ref) {
  return (
    <p
      ref={ref}
      className={[styles.description, className].filter(Boolean).join(' ')}
      {...props}
    />
  );
});

/* ---------------------------------------------------------------------------
   DialogBody — <div> with margin-top spacing
   --------------------------------------------------------------------------- */
export type DialogBodyProps = React.HTMLAttributes<HTMLDivElement> & {
  className?: string;
};

export const DialogBody = forwardRef<HTMLDivElement, DialogBodyProps>(
  function DialogBody({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={[styles.body, className].filter(Boolean).join(' ')}
        {...props}
      />
    );
  },
);

/* ---------------------------------------------------------------------------
   DialogActions — <div> flexbox end-aligned with gap
   --------------------------------------------------------------------------- */
export type DialogActionsProps = React.HTMLAttributes<HTMLDivElement> & {
  className?: string;
};

export const DialogActions = forwardRef<HTMLDivElement, DialogActionsProps>(
  function DialogActions({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={[styles.actions, className].filter(Boolean).join(' ')}
        {...props}
      />
    );
  },
);
