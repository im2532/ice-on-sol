import styles from './Navigation.module.css';

interface NavSubLinkProps {
  /** Sub-link text label */
  label: string;
  /** Navigation destination URL */
  href?: string;
  /** Whether this sub-link represents the current page */
  active?: boolean;
  /** Click handler */
  onClick?: () => void;
}

export function NavSubLink({
  label,
  href,
  active,
  onClick,
}: NavSubLinkProps) {
  const className = `${styles.subLink} ${active ? styles.subLinkActive : ''}`;

  const content = active ? (
    <>
      <span>../</span>
      <span>{label}</span>
      <span className={styles.subLinkIndicator} aria-hidden="true" />
    </>
  ) : (
    <span>{label}</span>
  );

  if (href) {
    return (
      <a
        className={className}
        href={href}
        aria-current={active ? 'page' : undefined}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      className={className}
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
    >
      {content}
    </button>
  );
}
