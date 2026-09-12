import styles from './Stepper.module.css';

interface PulsatingDotProps {
  className?: string;
}

export function PulsatingDot({ className }: PulsatingDotProps) {
  return (
    <div className={`${styles.pulsatingDot} ${className ?? ''}`} aria-hidden="true">
      <span className={styles.dotRingOuter} />
      <span className={styles.dotRingInner} />
      <span className={styles.dotCore} />
    </div>
  );
}
