'use client';

import { useId, useState, type FocusEvent, type FormEvent } from 'react';
import { Button, type ButtonSize, type ButtonVariant } from '../../Button';
import { Field } from '../../Field';
import { Select } from '../../Select';
import { VisuallyHidden } from '../../VisuallyHidden';
import type { ActionInput, ActionView } from '../../../../lib/v2/view/account-actions';
import styles from './AccountScreen.module.css';
import { CopyPacket } from './CopyPacket';
import { useLive } from './LiveActions';

/**
 * An account action as the screens render it: a link for a read, or a POST form carrying the verb
 * and ids in hidden fields. Under `LiveActions` the form submits, and shows the action's `input`;
 * a preview stops the submit, as KeepBar does, and leaves the input out. `liveOnly` leaves the whole
 * control out of a preview. The action's own `primary` makes it the orange element.
 * On keyboard focus it scrolls itself into view: Chrome leaves a control half outside a table that scrolls
 * on a phone when it takes focus by Tab, and its focus ring is then cut at the edge.
 */
export function ActionControl({
  action,
  variant = 'default',
  size = 'sm',
  liveOnly = false,
}: {
  action: ActionView;
  variant?: Exclude<ButtonVariant, 'primary'>;
  size?: ButtonSize;
  /** Shown on a live page only: a control no preview carries. */
  liveOnly?: boolean;
}) {
  const live = useLive();
  const inputId = useId();
  if (liveOnly && !live) return null;
  const v: ButtonVariant = action.primary ? 'primary' : variant;
  // Keyboard focus only: a tap focuses on press, and scrolling then would move the control away
  // from the finger before the release, so the tap would land elsewhere.
  const reveal = (e: FocusEvent<HTMLElement>) => {
    if (e.target.matches(':focus-visible')) {
      e.target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  };
  if (action.method === 'get' && live && action.copy) {
    return (
      <CopyPacket
        href={action.href}
        label={action.label}
        context={action.context}
        variant={v}
        size={size}
      />
    );
  }
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
      {live && action.inputs ? <Inputs inputs={action.inputs} prefix={inputId} /> : null}
      <Button type="submit" variant={v} size={size}>
        {action.label}
        {action.context ? <VisuallyHidden>{` ${action.context}`}</VisuallyHidden> : null}
      </Button>
    </form>
  );
}

/**
 * An action's fields on a live page. A select with `while` is disabled, and so not sent, unless the
 * select it names holds one of its values.
 */
function Inputs({ inputs, prefix }: { inputs: readonly ActionInput[]; prefix: string }) {
  const [chosen, setChosen] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      inputs.flatMap((i) => (i.kind === 'select' ? [[i.name, i.value] as const] : [])),
    ),
  );
  return (
    <>
      {inputs.map((i) => {
        const id = `${prefix}-${i.name}`;
        if (i.kind === 'text')
          return (
            <Field
              key={i.name}
              id={id}
              label={i.label}
              hideLabel
              type={i.type}
              name={i.name}
              placeholder={i.placeholder}
              defaultValue={i.value}
              required={i.required}
            />
          );
        if (i.kind === 'select')
          return (
            <Select
              key={i.name}
              id={id}
              label={i.label}
              hideLabel
              name={i.name}
              options={i.options}
              defaultValue={i.value}
              disabled={i.while ? !i.while.values.includes(chosen[i.while.name] ?? '') : false}
              onChange={(value) => setChosen((c) => ({ ...c, [i.name]: value }))}
            />
          );
        return (
          <label key={i.name} htmlFor={id}>
            <input id={id} type="checkbox" name={i.name} value={i.value} required={i.required} />{' '}
            {i.label}
          </label>
        );
      })}
    </>
  );
}
