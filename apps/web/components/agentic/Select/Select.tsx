'use client';

import { forwardRef } from 'react';
import styles from './Select.module.css';

export type SelectProps = {
  invalid?: boolean;
  className?: string;
  children?: React.ReactNode;
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'children'>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ invalid, className, disabled, children, ...rest }, ref) {
    const classNames = [
      styles.select,
      invalid ? styles.invalid : '',
      className ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <span data-slot="control" className={styles.wrapper}>
        <select
          ref={ref}
          className={classNames}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          {...rest}
        >
          {children}
        </select>
        <svg
          className={styles.chevron}
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M4 6l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
);
