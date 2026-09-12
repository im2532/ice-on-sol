import { type ReactNode, forwardRef } from 'react';
import { Icon } from '../Icon/Icon';
import styles from './Menu.module.css';

export type MenuItemSize = 'regular' | 'sm';

export interface MenuItemProps {
  label: string;
  helperText?: string;
  selected?: boolean;
  disabled?: boolean;
  shortcut?: ReactNode;
  icon?: ReactNode;
  hasSubmenu?: boolean;
  size?: MenuItemSize;
  onClick?: () => void;
}

export const MenuItem = forwardRef<HTMLButtonElement, MenuItemProps>(
  function MenuItem({
    label,
    helperText,
    selected = false,
    disabled = false,
    shortcut,
    icon,
    hasSubmenu = false,
    size = 'regular',
    onClick,
  }, ref) {
    const itemClass = disabled ? styles.itemDisabled : styles.item;
    const sizeClass = size === 'sm' ? styles.itemSm : styles.itemRegular;
    const contentClass = size === 'sm' ? styles.itemContentSm : styles.itemContent;
    const labelClass = selected ? styles.labelSelected : styles.label;

    const hasHelperText = helperText != null;

    return (
      <button
        ref={ref}
        type="button"
        className={`${itemClass} ${sizeClass}`}
        role="menuitem"
        aria-disabled={disabled || undefined}
        aria-checked={selected || undefined}
        tabIndex={disabled ? -1 : 0}
        onClick={disabled ? undefined : onClick}
      >
        <div className={contentClass}>
          {icon && icon}

          {hasHelperText ? (
            <div className={styles.labelGroup}>
              <span className={labelClass}>{label}</span>
              <span className={styles.helperText}>{helperText}</span>
            </div>
          ) : (
            <span className={labelClass}>{label}</span>
          )}

          {selected && !shortcut && !hasSubmenu && (
            <div className={styles.trailing}>
              <Icon name="checkmark" size={16} />
            </div>
          )}

          {shortcut && (
            <div className={styles.shortcut}>
              {shortcut}
            </div>
          )}

          {hasSubmenu && (
            <div className={styles.trailing}>
              <Icon name="chevron-right" size={14} />
            </div>
          )}
        </div>
      </button>
    );
  }
);
