import { Icon } from '../Icon/Icon';
import styles from './Navigation.module.css';

interface NavLinkProps {
  /** Link text label */
  label: string;
  /** Icon name from the design system icon set */
  icon?: string;
  /** Navigation destination URL */
  href?: string;
  /** Whether this link represents the current page */
  active?: boolean;
  /** Show a chevron indicator for expandable sections */
  chevron?: boolean;
  /** Controls chevron direction — true = up (expanded), false = down */
  expanded?: boolean;
  /** Render as a non-interactive section header label */
  asLabel?: boolean;
  /** Click handler */
  onClick?: () => void;
}

export function NavLink({
  label,
  icon,
  href,
  active,
  chevron,
  expanded,
  asLabel,
  onClick,
}: NavLinkProps) {
  if (asLabel) {
    return (
      <div className={styles.navLinkLabel}>
        <span>{label}</span>
      </div>
    );
  }

  const className = `${styles.navLink} ${chevron ? styles.navLinkFull : ''}`;

  if (href) {
    return (
      <a
        className={className}
        href={href}
        aria-current={active ? 'page' : undefined}
      >
        {icon && <Icon name={icon} size={16} />}
        <span>{label}</span>
        {chevron && (
          <span className={styles.navLinkChevron}>
            <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={16} />
          </span>
        )}
      </a>
    );
  }

  return (
    <button
      className={className}
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      aria-expanded={chevron ? expanded : undefined}
    >
      {icon && <Icon name={icon} size={16} />}
      <span>{label}</span>
      {chevron && (
        <span className={styles.navLinkChevron}>
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={16} />
        </span>
      )}
    </button>
  );
}
