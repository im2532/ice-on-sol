'use client';

import { forwardRef } from 'react';
import styles from './Input.module.css';

export type InputProps = {
  invalid?: boolean;
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'className'>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  function Input({ invalid, className, disabled, ...rest }, ref) {
    const classNames = [
      styles.input,
      invalid ? styles.invalid : '',
      className ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <span data-slot="control" className={styles.wrapper}>
        <input
          ref={ref}
          className={classNames}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          {...rest}
        />
      </span>
    );
  }
);
