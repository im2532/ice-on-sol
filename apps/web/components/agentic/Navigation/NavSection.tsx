import { type ReactNode } from 'react';
import { Icon } from '../Icon/Icon';
import styles from './Navigation.module.css';

interface NavSectionProps {
  /** Section children — NavLink or NavSubLink components */
  children: ReactNode;
  /** Optional section header label text */
  label?: string;
  /** Optional section header icon (renders tree-style header when combined with label) */
  icon?: string;
  /** Add top padding to visually separate from the section above */
  divider?: boolean;
}

export function NavSection({
  children,
  label,
  icon,
  divider,
}: NavSectionProps) {
  const isTreeSection = Boolean(label && icon);

  return (
    <div className={`${styles.section} ${divider ? styles.sectionDivider : ''}`}>
      {/* Section label (classic variant — text only, no icon) */}
      {label && !icon && (
        <div className={styles.navLinkLabel}>
          <span>{label}</span>
        </div>
      )}

      {/* Tree section header (icon + label) */}
      {isTreeSection && (
        <div className={styles.navLink}>
          <Icon name={icon!} size={16} />
          <span>{label}</span>
        </div>
      )}

      {/* Tree sections wrap children in an indented, border-left container */}
      {isTreeSection ? (
        <div className={styles.subLinksWrapper}>
          <div className={styles.subLinksContainer}>
            {children}
          </div>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
