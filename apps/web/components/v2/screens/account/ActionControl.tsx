'use client';

import type { FocusEvent, FormEvent } from 'react';
import { Button, type ButtonSize, type ButtonVariant } from '../../Button';
import { VisuallyHidden } from '../../VisuallyHidden';
import type { ActionView } from '../../../../lib/v2/view/account-actions';
import styles from './AccountScreen.module.css';
import { useLive } from './LiveActions';

/**
 * An account action as the screens render it: a link for a read, or a POST form carrying the verb
 * and ids in hidden fields. Under `LiveActions` the form submits; a preview stops the submit, as
 * KeepBar does. The action's own `primary` makes it the orange element.
 * On keyboard focus it scrolls itself into view: Chrome leaves a control half outside a table that scrolls
 * on a phone when it takes focus by Tab, and its focus ring is then cut at the edge.
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
  const live = useLive();
  const v: ButtonVariant = action.primary ? 'primary' : variant;
  // Keyboard focus only: a tap focuses on press, and scrolling then would move the control away
  // from the finger before the release, so the tap would land elsewhere.
  const reveal = (e: FocusEvent<HTMLElement>) => {
    if (e.target.matches(':focus-visible')) {
      e.target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  };
  if (action.method === 'get') {
    return (
      <span className={styles.inlineForm} onFocus={reveal}>
        <Button href={action.href} variant={v} size={size}>
          {action.label}
          {action.context ? <VisuallyHidden>{` ${action.context}`}</VisuallyHidden> : null}
        </Button>
      </span>
    );
  }
  return (
    <form
      onFocus={reveal}
      method="post"
      action={action.href}
      className={styles.inlineForm}
      onSubmit={live ? undefined : (e: FormEvent) => e.preventDefault()}
    >
      {Object.entries(action.fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" variant={v} size={size}>
        {action.label}
        {action.context ? <VisuallyHidden>{` ${action.context}`}</VisuallyHidden> : null}
      </Button>
    </form>
  );
}
