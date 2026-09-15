'use client';

import { forwardRef } from 'react';
import Link from 'next/link';
import styles from './Button.module.css';

/* ---------------------------------------------------------------------------
   Discriminated union prevents invalid variant combos:
   - variant="solid" (default)
   - outline={true}
   - plain={true}
   Only one may be specified at a time.
   --------------------------------------------------------------------------- */
type VariantProps =
  | { variant?: 'solid'; outline?: never; plain?: never }
  | { variant?: never; outline: true; plain?: never }
  | { variant?: never; outline?: never; plain: true };

type SharedProps = {
  size?: 'sm' | 'md' | 'lg';
  danger?: boolean;
  fullWidth?: boolean;
  loading?: boolean;
  className?: string;
  children?: React.ReactNode;
};

type ButtonAsButton = SharedProps &
  VariantProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof SharedProps> & {
    href?: never;
  };

type ButtonAsAnchor = SharedProps &
  VariantProps &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof SharedProps> & {
    href: string;
  };

export type ButtonProps = ButtonAsButton | ButtonAsAnchor;

function resolveVariant(props: ButtonProps): 'solid' | 'outline' | 'plain' {
  if ('outline' in props && props.outline) return 'outline';
  if ('plain' in props && props.plain) return 'plain';
  return 'solid';
}

export const Button = forwardRef<
  HTMLButtonElement | HTMLAnchorElement,
  ButtonProps
>(function Button(props, ref) {
  const {
    size = 'md',
    danger,
    fullWidth,
    loading,
    className,
    children,
    ...rest
  } = props;

  // Remove discriminated union keys before spreading onto DOM element
  const domProps = { ...rest } as Record<string, unknown>;
  delete domProps.variant;
  delete domProps.outline;
  delete domProps.plain;

  const variant = resolveVariant(props);

  const classNames = [
    styles.button,
    styles[variant],
    styles[size],
    danger ? styles.danger : '',
    fullWidth ? styles.fullWidth : '',
    loading ? styles.loading : '',
    // For anchor elements we use .disabled class since <a> has no :disabled pseudo-class
    'href' in props && props.href && domProps['aria-disabled'] ? styles.disabled : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const spinnerEl = loading ? <span className={styles.spinner} aria-hidden="true" /> : null;

  if ('href' in props && props.href) {
    const href = domProps.href as string;
    delete domProps.href;
    const anchorRest = domProps as React.AnchorHTMLAttributes<HTMLAnchorElement>;

    if (href.startsWith('/')) {
      return (
        <Link
          ref={ref as React.Ref<HTMLAnchorElement>}
          href={href}
          className={classNames}
          data-variant={variant}
          aria-disabled={loading || undefined}
          {...anchorRest}
        >
          {spinnerEl}
          {children}
        </Link>
      );
    }

    return (
      <a
        ref={ref as React.Ref<HTMLAnchorElement>}
        href={href}
        className={classNames}
        data-variant={variant}
        aria-disabled={loading || undefined}
        {...anchorRest}
      >
        {spinnerEl}
        {children}
      </a>
    );
  }

  const buttonRest = domProps as React.ButtonHTMLAttributes<HTMLButtonElement>;

  return (
    <button
      ref={ref as React.Ref<HTMLButtonElement>}
      type={buttonRest.type ?? 'button'}
      className={classNames}
        data-variant={variant}
      disabled={loading || (buttonRest.disabled ?? false)}
      {...buttonRest}
    >
      {spinnerEl}
      {children}
    </button>
  );
});
