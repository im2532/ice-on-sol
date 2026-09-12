import { type ReactNode } from 'react';
import styles from './Stepper.module.css';

export type StepperStepVariant = 'completed' | 'active' | 'disabled';

export interface StepperStepProps {
  variant: StepperStepVariant;
  label: string;
  icon: ReactNode;
  children?: ReactNode;
  onClick?: () => void;
}

const STEP_CLASSES: Record<StepperStepVariant, string> = {
  completed: styles.stepCompleted,
  active: styles.stepActive,
  disabled: styles.stepDisabled,
};

const ICON_CLASSES: Record<StepperStepVariant, string> = {
  completed: styles.stepIconCompleted,
  active: styles.stepIconActive,
  disabled: styles.stepIconDisabled,
};

const LABEL_CLASSES: Record<StepperStepVariant, string> = {
  completed: styles.stepLabelCompleted,
  active: styles.stepLabelActive,
  disabled: styles.stepLabelDisabled,
};

export function StepperStep({ variant, label, icon, children, onClick }: StepperStepProps) {
  const isInteractive = variant !== 'active' && onClick != null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isInteractive && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onClick?.();
    }
  };

  return (
    <>
      <div
        className={STEP_CLASSES[variant]}
        role="listitem"
        aria-current={variant === 'active' ? 'step' : undefined}
        tabIndex={isInteractive ? 0 : undefined}
        onClick={isInteractive ? onClick : undefined}
        onKeyDown={isInteractive ? handleKeyDown : undefined}
      >
        <div className={ICON_CLASSES[variant]}>{icon}</div>
        <span className={LABEL_CLASSES[variant]}>{label}</span>
      </div>
      {children && (
        <div className={styles.substepsWrapper} role="group" aria-label={`${label} substeps`}>
          {children}
        </div>
      )}
    </>
  );
}
