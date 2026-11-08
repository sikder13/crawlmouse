'use client';

import { useState, type FormEvent } from 'react';
import styles from './Switch.module.css';

export interface SwitchProps {
  /** The setting's own row text, which names the switch (DESIGN-LOCK §7.6). */
  label: string;
  /** The field the form posts: "true" or "false", the state the switch moves to. */
  name: string;
  on: boolean;
  /** Where the new state is posted. */
  action: string;
  /** Other fields the post carries, the setting's id among them. */
  fields: Record<string, string>;
}

/**
 * An on/off setting: a native button with role="switch" and aria-checked, inside a POST form. A
 * native button is in the tab order and answers Enter and Space, so it needs no key handling of its
 * own. The routes are not built yet (CC-27b), so the submit is stopped; the switch still flips.
 *
 * The form posts the state the switch moves to, `!checked`. The browser reads the form after the
 * click's handlers and React's re-render, so the switch flips in a later task: flipped in the click
 * handler, the field would already hold the next click's value when the form is read.
 */
export function Switch({ label, name, on, action, fields }: SwitchProps) {
  const [checked, setChecked] = useState(on);
  return (
    <form
      method="post"
      action={action}
      className={styles.form}
      onSubmit={(e: FormEvent) => e.preventDefault()}
    >
      {Object.entries(fields).map(([field, value]) => (
        <input key={field} type="hidden" name={field} value={value} />
      ))}
      <input type="hidden" name={name} value={String(!checked)} />
      <button
        type="submit"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={styles.switch}
        onClick={() => setTimeout(() => setChecked((c) => !c), 0)}
      >
        <i />
      </button>
    </form>
  );
}
