import { Icon } from '../Icon/Icon';
import { PulsatingDot } from './PulsatingDot';
import styles from './Stepper.module.css';

export type StepperSubstepState = 'completed' | 'active' | 'disabled';

export interface StepperSubstepProps {
  state: StepperSubstepState;
  label: string;
}

const LABEL_CLASSES: Record<StepperSubstepState, string> = {
  completed: styles.substepLabelCompleted,
  active: styles.substepLabelActive,
  disabled: styles.substepLabelDisabled,
};

const DOT_MAP: Record<StepperSubstepState, 'checkmark' | 'pulse' | 'disabled'> = {
  completed: 'checkmark',
  active: 'pulse',
  disabled: 'disabled',
};

export function StepperSubstep({ state, label }: StepperSubstepProps) {
  const dot = DOT_MAP[state];

  return (
    <div className={styles.substep}>
      {dot === 'checkmark' && (
        <div className={styles.substepDot}>
          <Icon name="checkmark-filled" size={14} mode="img" />
        </div>
      )}
      {dot === 'pulse' && <PulsatingDot />}
      {dot === 'disabled' && <div className={styles.substepDotDisabled} />}

      <span className={LABEL_CLASSES[state]}>{label}</span>
    </div>
  );
}
