'use client';

import { useId, useState, type FormEvent } from 'react';
import { checkHost } from '../../../../lib/v2/hostname';
import { Button } from '../../Button';
import { Field } from '../../Field';
import styles from './HomeScreen.module.css';

/**
 * "Start the audit": checks the address and says what to fix under the field. In the preview it
 * posts nowhere; a valid address is acknowledged in place. Keyboard-complete: Enter submits, an
 * error moves focus back to the field and is read out with it. The error (an alert) and the
 * acknowledgement (a status) each have a region on the page from the start, empty until used, so
 * a reader is told when text arrives in one.
 */
export function AuditForm({
  fieldId,
  label,
  primary,
  className,
  inputClassName,
  buttonClassName,
}: {
  fieldId: string;
  /** The form's name as a landmark; a repeat of a form already named is left unnamed. */
  label?: string;
  /** The hero form carries the screen's one orange element; the closing repeat is neutral. */
  primary: boolean;
  className?: string;
  inputClassName?: string;
  buttonClassName?: string;
}) {
  const messageId = useId();
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem('url') as HTMLInputElement;
    const r = checkHost(input.value);
    if (r.ok) {
      setMessage({
        kind: 'ok',
        text: `Preview only: nothing was sent. The audit of ${r.host} would start here.`,
      });
    } else {
      setMessage({ kind: 'error', text: r.message });
      input.focus();
    }
  }

  const error = message?.kind === 'error';
  return (
    <form className={className} aria-label={label} noValidate onSubmit={submit}>
      <div className={`${styles.fieldStack} ${inputClassName ?? ''}`}>
        <Field
          id={fieldId}
          name="url"
          label="Website URL"
          hideLabel
          type="url"
          placeholder="yourdomain.com"
          autoComplete="url"
          size="lg"
          invalid={error}
          describedBy={message ? `${messageId}-${message.kind}` : undefined}
        />
        <p id={`${messageId}-error`} className={styles.formError} role="alert" data-v2-addition="">
          {error ? message.text : null}
        </p>
        <p id={`${messageId}-ok`} className={styles.formNote} role="status" data-v2-addition="">
          {message?.kind === 'ok' ? message.text : null}
        </p>
      </div>
      <Button
        type="submit"
        variant={primary ? 'primary' : 'default'}
        size="lg"
        className={buttonClassName}
      >
        Start the audit
      </Button>
    </form>
  );
}
