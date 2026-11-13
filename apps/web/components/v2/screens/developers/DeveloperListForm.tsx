'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { type TurnstileInstance } from '@marsidev/react-turnstile';
import { Turnstile } from '@/components/ui/Turnstile';
import { turnstileEnabled, TURNSTILE_SITE_KEY } from '@/lib/turnstile-client';
import type { DevelopersView } from '../../../../lib/v2/view/developers';
import { Button } from '../../Button';
import { Field } from '../../Field';
import styles from './DevelopersScreen.module.css';

type Message = { kind: 'error' | 'ok'; text: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The developer list's form: `POST /api/developers` with the body v1's waitlist form sends,
 * `{email, turnstileToken}`, and the route unchanged. The route asks for the person check whenever
 * Turnstile is enforced, so the widget is shown from the start while a site key is configured, as
 * v1's form shows it. Without `live` (the preview) it posts nowhere.
 */
export function DeveloperListForm({
  copy,
  live = false,
}: {
  copy: DevelopersView['waitlist'];
  live?: boolean;
}) {
  const messageId = useId();
  const widget = useRef<TurnstileInstance>(undefined);
  const [token, setToken] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const needToken = turnstileEnabled(TURNSTILE_SITE_KEY);

  function refuse(text: string, field: HTMLInputElement) {
    widget.current?.reset();
    setToken(null);
    setMessage({ kind: 'error', text });
    field.focus();
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const field = e.currentTarget.elements.namedItem('email') as HTMLInputElement;
    const email = field.value.trim();
    if (!EMAIL.test(email)) {
      refuse(copy.invalid, field);
      return;
    }
    if (!live) {
      setMessage({ kind: 'ok', text: copy.preview });
      return;
    }
    if (busy) return;
    setBusy(true);
    setMessage({ kind: 'ok', text: copy.sending });
    try {
      const res = await fetch('/api/developers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, turnstileToken: token ?? undefined }),
      });
      if (res.ok) {
        setDone(true);
        setMessage({ kind: 'ok', text: copy.done });
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: unknown };
      const code = typeof data.error === 'string' ? data.error : 'failed';
      refuse(copy.errors[code] ?? copy.errors.failed!, field);
    } catch {
      refuse(copy.errors.failed!, field);
    } finally {
      setBusy(false);
    }
  }

  const error = message?.kind === 'error';
  return (
    <form className={styles.listForm} aria-label={copy.label} noValidate onSubmit={submit}>
      <div className={styles.fieldStack}>
        <Field
          id="dev-email"
          name="email"
          label={copy.field}
          hideLabel
          type="email"
          placeholder={copy.placeholder}
          autoComplete="email"
          invalid={error}
          describedBy={message ? `${messageId}-${message.kind}` : undefined}
        />
        <p id={`${messageId}-error`} className={styles.formError} role="alert">
          {error ? message.text : null}
        </p>
        <p id={`${messageId}-ok`} className={styles.formNote} role="status">
          {message?.kind === 'ok' ? message.text : null}
        </p>
        {live && !done ? <Turnstile ref={widget} onToken={setToken} /> : null}
      </div>
      <Button type="submit" disabled={busy || done || (live && needToken && !token)}>
        {copy.submit}
      </Button>
    </form>
  );
}
