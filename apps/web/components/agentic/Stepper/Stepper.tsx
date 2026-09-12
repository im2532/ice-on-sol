import { type ReactNode } from 'react';
import styles from './Stepper.module.css';

interface StepperProps {
  children: ReactNode;
  className?: string;
}

export function Stepper({ children, className }: StepperProps) {
  return (
    <div className={`${styles.stepper} ${className ?? ''}`} role="list" aria-label="Progress steps">
      {children}
    </div>
  );
}
