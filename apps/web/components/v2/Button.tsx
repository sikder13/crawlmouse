import type { ReactNode } from 'react';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'default' | 'quiet' | 'inverse';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  /**
   * `primary` is the screen's one orange element (rule 3): the reader's best action. A screen
   * renders exactly one; the screen tests and the visual harness count `data-v2-primary`.
   */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Renders a link styled as a button. */
  href?: string;
  /** Renders a non-interactive span that looks like a button, for illustrations and link interiors. */
  presentational?: boolean;
  type?: 'button' | 'submit';
  disabled?: boolean;
  title?: string;
  className?: string;
  onClick?: () => void;
  children: ReactNode;
}

/** A button, a link that looks like one, or a picture of one. */
export function Button({
  variant = 'default',
  size = 'md',
  href,
  presentational = false,
  type = 'button',
  disabled = false,
  title,
  className,
  onClick,
  children,
}: ButtonProps) {
  const cls = [
    styles.btn,
    variant === 'default' ? null : styles[variant],
    size === 'md' ? null : styles[size],
    className,
  ]
    .filter(Boolean)
    .join(' ');
  const data = {
    'data-v2-button': variant,
    ...(variant === 'primary' ? { 'data-v2-primary': '' } : {}),
  };

  if (presentational) {
    return (
      <span className={cls} {...data}>
        {children}
      </span>
    );
  }
  if (href !== undefined) {
    return (
      <a
        className={cls}
        href={disabled ? undefined : href}
        aria-disabled={disabled || undefined}
        title={title}
        onClick={onClick}
        {...data}
      >
        {children}
      </a>
    );
  }
  return (
    <button
      className={cls}
      type={type}
      disabled={disabled}
      title={title}
      onClick={onClick}
      {...data}
    >
      {children}
    </button>
  );
}
