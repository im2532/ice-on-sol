import styles from './Menu.module.css';

export interface MenuSectionHeaderProps {
  label: string;
}

export function MenuSectionHeader({ label }: MenuSectionHeaderProps) {
  return (
    <div className={styles.sectionHeader} role="presentation">
      {label}
    </div>
  );
}
