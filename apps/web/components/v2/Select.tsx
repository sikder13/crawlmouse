import layout from './layout.module.css';
import styles from './Select.module.css';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  id: string;
  label: string;
  /** The label is hidden visually and stays for screen readers. */
  hideLabel?: boolean;
  name: string;
  options: readonly SelectOption[];
  defaultValue?: string;
  /** A disabled select is not sent with its form. */
  disabled?: boolean;
  /** Told the chosen value, for a form whose other fields follow it. */
  onChange?: (value: string) => void;
  /** The id of a form the select belongs to when it sits outside it. */
  form?: string;
}

/** A labelled native select: the browser gives it its keyboard, its list and its form value. */
export function Select({
  id,
  label,
  hideLabel = false,
  options,
  onChange,
  ...select
}: SelectProps) {
  const control = (
    <select
      id={id}
      className={styles.select}
      {...select}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
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
