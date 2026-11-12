'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import type { TurnstileInstance } from '@marsidev/react-turnstile';
import { Turnstile } from '@/components/ui/Turnstile';
import { turnstileEnabled, TURNSTILE_SITE_KEY } from '@/lib/turnstile-client';
import { PRICING_COPY } from '@/lib/v2/copy/pricing';
import { Button } from '../../Button';
import { Field } from '../../Field';
import fieldStyles from '../../Field.module.css';
import styles from './Pricing.module.css';

const COPY = PRICING_COPY.agencyPlus;

export type ContactState = 'idle' | 'sending' | 'sent' | { error: string };

/**
 * The Agency Plus contact form (FACTS A3). It posts JSON to /api/contact/agency-plus with a
 * Turnstile token when a site key is configured; a token works once, so the widget is reset after
 * each answer. Not the orange element: the row it belongs to carries none.
 */
/** Where the form posts its JSON; marked on the form as `data-endpoint` so a test can resolve it. */
export const AGENCY_PLUS_ENDPOINT = '/api/contact/agency-plus';

export function AgencyPlusForm({ initial = 'idle' }: { initial?: ContactState }) {
  const ids = useId();
  const widget = useRef<TurnstileInstance | undefined>(undefined);
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<ContactState>(initial);
  const needToken = turnstileEnabled(TURNSTILE_SITE_KEY);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget.elements;
    const value = (name: string) =>
      (form.namedItem(name) as HTMLInputElement | HTMLTextAreaElement).value.trim();
    const sites = Number(value('sites'));
    const note = value('note');
    setState('sending');
    try {
      const res = await fetch(AGENCY_PLUS_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: value('email'),
          sites,
          ...(note ? { note } : {}),
          ...(token ? { turnstileToken: token } : {}),
        }),
      });
      if (res.ok) {
        setState('sent');
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: unknown };
      setState({ error: typeof body.error === 'string' ? body.error : 'failed' });
    } catch {
      setState({ error: 'failed' });
    } finally {
      widget.current?.reset();
      setToken(null);
    }
  }

  if (state === 'sent') {
    return (
      <p className={styles.message} role="status">
        {COPY.sent}
      </p>
    );
  }
  const error = typeof state === 'object' ? (COPY.errors[state.error] ?? COPY.errors.failed) : null;
  return (
    <form
      className={styles.form}
      aria-label={COPY.formTitle}
      data-endpoint={AGENCY_PLUS_ENDPOINT}
      onSubmit={submit}
    >
      <Field
        id={`${ids}-email`}
        name="email"
        label={COPY.email}
        type="email"
        autoComplete="email"
        placeholder="you@youragency.com"
        required
      />
      <label htmlFor={`${ids}-sites`} className={styles.label}>
        {COPY.sites}
      </label>
      <input
        id={`${ids}-sites`}
        name="sites"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        required
        className={`${fieldStyles.input} ${styles.wide}`}
      />
      <label htmlFor={`${ids}-note`} className={styles.label}>
        {COPY.note} <span className={styles.mut}>· {COPY.noteHint}</span>
      </label>
      <textarea
        id={`${ids}-note`}
        name="note"
        maxLength={2000}
        className={`${fieldStyles.input} ${styles.textarea}`}
      />
      <Turnstile ref={widget} onToken={setToken} />
      <Button type="submit" disabled={state === 'sending' || (needToken && !token)}>
        {COPY.submit}
      </Button>
      <p className={styles.error} role="alert">
        {error}
      </p>
    </form>
  );
}
