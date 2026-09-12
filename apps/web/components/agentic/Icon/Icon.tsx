import styles from './Icon.module.css';

type IconSize = 8 | 12 | 13 | 14 | 16 | 20 | 24 | 32 | 40;

interface IconProps {
  /** Icon filename without extension, e.g. "plus", "trash" */
  name: string;
  /** Maps to design token --icon-{size} */
  size?: IconSize;
  /** Rendering mode: mask (monochrome, inherits color) or img (multi-color) */
  mode?: 'mask' | 'img';
  /** Additional CSS class */
  className?: string;
  /** Accessible label; if omitted, icon is decorative (aria-hidden) */
  alt?: string;
}

const sizeMap: Record<IconSize, string> = {
  8: 'var(--icon-8)',
  12: 'var(--icon-12)',
  13: 'var(--icon-13)',
  14: 'var(--icon-14)',
  16: 'var(--icon-16)',
  20: 'var(--icon-20)',
  24: 'var(--icon-24)',
  32: 'var(--icon-32)',
  40: 'var(--icon-40)',
};

export function Icon({
  name,
  size = 16,
  mode = 'mask',
  className,
  alt,
}: IconProps) {
  const resolvedSize = sizeMap[size];
  const src = `/agentic/assets/icons/${name}.svg`;

  if (mode === 'img') {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt ?? ''}
        aria-hidden={alt ? undefined : true}
        className={`${styles.img} ${className ?? ''}`}
        style={{ width: resolvedSize, height: resolvedSize }}
      />
    );
  }

  return (
    <span
      role={alt ? 'img' : 'presentation'}
      aria-label={alt}
      aria-hidden={alt ? undefined : true}
      className={`${styles.mask} ${className ?? ''}`}
      style={{
        width: resolvedSize,
        height: resolvedSize,
        maskImage: `url(${src})`,
        WebkitMaskImage: `url(${src})`,
      }}
    />
  );
}
