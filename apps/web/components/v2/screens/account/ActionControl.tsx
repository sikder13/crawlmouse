'use client';

import type { FormEvent } from 'react';
import { Button, type ButtonSize, type ButtonVariant } from '../../Button';
import type { ActionView } from '../../../../lib/v2/view/account-actions';
import styles from './AccountScreen.module.css';

/**
 * An account action as the screens render it: a link for a read, or a POST form carrying the verb
 * and ids in hidden fields. Not wired to an account yet: the routes are CC-26b's, so a preview
 * stops the submit, as KeepBar does. The action's own `primary` makes it the orange element.
 */
export function ActionControl({
  action,
  variant = 'default',
  size = 'sm',
}: {
  action: ActionView;
  variant?: Exclude<ButtonVariant, 'primary'>;
  size?: ButtonSize;
}) {
  const v: ButtonVariant = action.primary ? 'primary' : variant;
  if (action.method === 'get') {
    return (
      <Button href={action.href} variant={v} size={size}>
        {action.label}
      </Button>
    );
  }
  return (
    <form
      method="post"
      action={action.href}
      className={styles.inlineForm}
      onSubmit={(e: FormEvent) => e.preventDefault()}
    >
      {Object.entries(action.fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" variant={v} size={size}>
        {action.label}
      </Button>
    </form>
  );
}
