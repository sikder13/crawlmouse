import type { CSSProperties } from 'react';
import layout from './layout.module.css';
import styles from './Field.module.css';

export interface FieldProps {
  id: string;
  label: string;
  /** The locked screens hide the label; it stays for screen readers. */
  hideLabel?: boolean;
  type?: 'url' | 'email' | 'text' | 'search';
  name?: string;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  size?: 'md' | 'lg';
  className?: string;
  style?: CSSProperties;
}

/**
 * A labelled text input. With a hidden label it renders as siblings, and the label is absolutely
 * positioned, so it takes no room (and no gap) in a flex row.
 */
export function Field({
  id,
  label,
  hideLabel = false,
  type = 'text',
  size = 'md',
  className,
  style,
  ...input
}: FieldProps) {
  const control = (
    <input
      id={id}
      type={type}
      className={[styles.input, size === 'lg' ? styles.lg : null, className]
        .filter(Boolean)
        .join(' ')}
      style={style}
      {...input}
    />
  );
  if (hideLabel) {
    return (
      <>
        <label htmlFor={id} className={layout.srOnly} data-v2-sr-only="">
          {label}
        </label>
        {control}
      </>
    );
  }
  return (
    <div className={styles.stack}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {control}
    </div>
  );
}
