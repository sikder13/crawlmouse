import type { CSSProperties, ReactNode } from 'react';
import styles from './Heading.module.css';

export interface HeadingProps {
  level: 1 | 2 | 3;
  /** xl 56, l 32, m 26, s 18; xl, l and m step down on phones. */
  size: 'xl' | 'l' | 'm' | 's';
  id?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

/** A heading in the display face, weight 600, tracking −0.02em (rule 5). */
export function Heading({ level, size, id, className, style, children }: HeadingProps) {
  const Tag = `h${level}` as const;
  return (
    <Tag
      id={id}
      className={[styles.h, styles[size], className].filter(Boolean).join(' ')}
      style={style}
    >
      {children}
    </Tag>
  );
}
