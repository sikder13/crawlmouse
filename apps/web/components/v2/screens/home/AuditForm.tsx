'use client';

import { useCallback, useId, useRef, useState, type FormEvent } from 'react';
import { Turnstile } from '@/components/ui/Turnstile';
import { turnstileEnabled, TURNSTILE_SITE_KEY } from '@/lib/turnstile-client';
import { checkHost } from '../../../../lib/v2/hostname';
import { Button } from '../../Button';
import { Field } from '../../Field';
import { START_COPY, startCheck, urlOf, type StartRequest } from './start-check';
import styles from './HomeScreen.module.css';

type Message = { kind: 'error' | 'ok'; text: string };

/**
 * "Start the audit": checks the address and says what to fix under the field. Keyboard-complete:
 * Enter submits, an error moves focus back to the field and is read out with it. The error (an
 * alert) and the acknowledgement (a status) each have a region on the page from the start, empty
 * until used, so a reader is told when text arrives in one.
 *
 * With `start` it posts to `POST /api/checks` and opens the audit's page on the answer. Each
 * submit mints its own request id; when the route asks for the person check, the widget appears
 * and its token goes with the same request id, so the two attempts name one check. Without `start`
 * (the preview) it posts nowhere and acknowledges a valid address in place.
 */
export function AuditForm({
  fieldId,
  label,
  primary,
  start = false,
  className,
  inputClassName,
  buttonClassName,
}: {
  fieldId: string;
  /** The form's name as a landmark; a repeat of a form already named is left unnamed. */
  label?: string;
  /** The hero form carries the screen's one orange element; the closing repeat is neutral. */
  primary: boolean;
  start?: boolean;
  className?: string;
  inputClassName?: string;
  buttonClassName?: string;
}) {
  const messageId = useId();
  const input = useRef<HTMLInputElement | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);
  /** The request waiting for the person check's token. */
  const [waiting, setWaiting] = useState<StartRequest | null>(null);

  const refuse = useCallback((text: string) => {
    setBusy(false);
    setWaiting(null);
    setMessage({ kind: 'error', text });
    input.current?.focus();
  }, []);

  const send = useCallback(
    async (request: StartRequest) => {
      const outcome = await startCheck(request);
      if (outcome.ok) {
        window.location.assign(`/audit/${outcome.checkId}`);
        return;
      }
      // Asked once per submit: a second ask, or no widget to answer with, is a failed check.
      if (outcome.code === 'captcha_required') {
        if (request.turnstileToken === undefined && turnstileEnabled(TURNSTILE_SITE_KEY)) {
          setMessage({ kind: 'ok', text: START_COPY.captcha_required });
          setWaiting(request);
          return;
        }
        refuse(START_COPY.captcha_failed);
        return;
      }
      refuse(START_COPY[outcome.code]);
    },
    [refuse],
  );

  const onToken = useCallback(
    (token: string | null) => {
      if (!waiting) return;
      const request = waiting;
      setWaiting(null);
      if (token === null) refuse(START_COPY.captcha_failed);
      else void send({ ...request, turnstileToken: token });
    },
    [waiting, refuse, send],
  );

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const field = e.currentTarget.elements.namedItem('url') as HTMLInputElement;
    input.current = field;
    const r = checkHost(field.value);
    if (!r.ok) {
      setMessage({ kind: 'error', text: r.message });
      field.focus();
      return;
    }
    if (!start) {
      setMessage({
        kind: 'ok',
        text: `Preview only: nothing was sent. The audit of ${r.host} would start here.`,
      });
      return;
    }
    if (busy) return;
    setBusy(true);
    setMessage({ kind: 'ok', text: `Starting the audit of ${r.host}…` });
    void send({ url: urlOf(field.value), requestId: crypto.randomUUID() });
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
        {waiting ? <Turnstile onToken={onToken} /> : null}
      </div>
      <Button
        type="submit"
        variant={primary ? 'primary' : 'default'}
        size="lg"
        className={buttonClassName}
        disabled={busy}
      >
        Start the audit
      </Button>
    </form>
  );
}
