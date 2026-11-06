'use client';

import { useState, type FormEvent } from 'react';
import type { ActionView } from '../../../../lib/v2/view/account-actions';
import styles from './SiteScreen.module.css';

/**
 * One alert rule's on/off switch. It is named by the rule's own row text (DESIGN-LOCK §7.6) and
 * posts the new state to the alert-rules route, which a preview stops; the switch still flips.
 */
export function AlertSwitch({
  on,
  label,
  action,
}: {
  on: boolean;
  label: string;
  action: ActionView;
}) {
  const [checked, setChecked] = useState(on);
  return (
    <form
      method="post"
      action={action.href}
      className={styles.switchForm}
      onSubmit={(e: FormEvent) => e.preventDefault()}
    >
      {Object.entries(action.fields).map(([name, value]) => (
        <input
          key={name}
          type="hidden"
          name={name}
          value={name === 'enabled' ? String(!checked) : value}
        />
      ))}
      <button
        type="submit"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={styles.switch}
        onClick={() => setChecked((c) => !c)}
      >
        <i />
      </button>
    </form>
  );
}
