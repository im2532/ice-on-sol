'use client';

import { forwardRef } from 'react';
import styles from './Textarea.module.css';

export type TextareaProps = {
  invalid?: boolean;
  className?: string;
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ invalid, className, disabled, ...rest }, ref) {
    const classNames = [
      styles.textarea,
      invalid ? styles.invalid : '',
      className ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <span data-slot="control" className={styles.wrapper}>
        <textarea
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
