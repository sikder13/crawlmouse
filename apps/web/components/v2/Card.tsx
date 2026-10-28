import type { CSSProperties, ReactNode } from 'react';
import styles from './Card.module.css';

export interface CardProps {
  as?: 'div' | 'section' | 'article';
  /** `raised` is the s1 surface; `sunken` is the s2 step used for the one emphasised card. */
  tone?: 'raised' | 'sunken';
  /** Renders the whole card as a link (a door into a section). */
  href?: string;
  id?: string;
  className?: string;
  style?: CSSProperties;
  'aria-label'?: string;
  children: ReactNode;
}

/** A single object on a hairline surface (rules 2 and 8). */
export function Card({
  as: Tag = 'div',
  tone = 'raised',
  href,
  id,
  className,
  style,
  children,
  ...aria
}: CardProps) {
  const cls = [styles.card, tone === 'sunken' ? styles.sunken : null, className];
  if (href !== undefined) {
    return (
      <a
        href={href}
        id={id}
        className={[...cls, styles.link].filter(Boolean).join(' ')}
        style={style}
        data-v2-card={tone}
        {...aria}
      >
        {children}
      </a>
    );
  }
  return (
    <Tag
      id={id}
      className={cls.filter(Boolean).join(' ')}
      style={style}
      data-v2-card={tone}
      {...aria}
    >
      {children}
    </Tag>
  );
}
