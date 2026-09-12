import styles from './Stepper.module.css';

export function StepperConnector() {
  return (
    <div className={styles.connector} aria-hidden="true">
      <div className={styles.connectorLine} />
    </div>
  );
}
