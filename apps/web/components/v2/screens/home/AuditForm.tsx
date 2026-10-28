'use client';

import { useId, useState, type FormEvent } from 'react';
import { checkHost } from '../../../../lib/v2/hostname';
import { Button } from '../../Button';
import { Field } from '../../Field';
import styles from './HomeScreen.module.css';

/**
 * "Start the audit": checks the address and says what to fix beside the field. In the preview it
 * posts nowhere; a valid address is acknowledged in place. Keyboard-complete: Enter submits, an
 * error moves focus back to the field and is read out with it.
 */
export function AuditForm({
  fieldId,
  primary,
  className,
  inputClassName,
  buttonClassName,
}: {
  fieldId: string;
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
    <>
      <form className={className} aria-label="Start an audit" noValidate onSubmit={submit}>
        <Field
          id={fieldId}
          name="url"
          label="Website URL"
          hideLabel
          type="url"
          placeholder="yourdomain.com"
          autoComplete="url"
          size="lg"
          className={inputClassName}
          invalid={error}
          describedBy={message ? messageId : undefined}
        />
        <Button
          type="submit"
          variant={primary ? 'primary' : 'default'}
          size="lg"
          className={buttonClassName}
        >
          Start the audit
        </Button>
      </form>
      <p
        id={messageId}
        className={error ? styles.formError : styles.formNote}
        role={error ? 'alert' : 'status'}
        data-v2-addition=""
        hidden={!message}
      >
        {message?.text}
      </p>
    </>
  );
}
