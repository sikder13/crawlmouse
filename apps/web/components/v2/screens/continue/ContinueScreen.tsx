'use client';

import { useId, useState, type FormEvent } from 'react';
import { track } from '@/lib/analytics';
import type { DoorEvent } from '@/lib/auth/first-login';
import { AUTH_LINK_MINUTES } from '@/lib/auth/constants';
import { Button } from '../../Button';
import { Field } from '../../Field';
import { Heading } from '../../Heading';
import { PageShell } from '../../PageShell';
import layout from '../../layout.module.css';
import { SEND_COPY, sendLink, type SendOutcome } from '../signup/send-link';
import { useTurnstile } from '../signup/useTurnstile';
import styles from '../check-email/Door.module.css';

export type ContinueState = 'idle' | 'expired';

/**
 * The sign-in landing (CC-25 D3). The link's token is already in an httpOnly cookie when this page
 * renders, and this page never sees it. "Continue" posts to /login/verify. With JavaScript the post
 * asks for JSON, fires the funnel events the sign-in produced through track() (consent applies),
 * then navigates; without it the form posts and the server redirects.
 */
export function ContinueScreen({ state: initial }: { state: ContinueState }) {
  const [state, setState] = useState<ContinueState>(initial);
  return (
    <PageShell header="app" footer={false}>
      <main className={`${layout.wrap} ${styles.main}`}>
        <section className={styles.column}>
          {state === 'idle' ? <Idle onExpired={() => setState('expired')} /> : <Expired />}
        </section>
      </main>
    </PageShell>
  );
}

function Idle({ onExpired }: { onExpired: () => void }) {
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    try {
      const res = await fetch('/login/verify', {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      const body = (await res.json()) as { next?: unknown; events?: DoorEvent[] };
      if (typeof body.next !== 'string' || !body.next.startsWith('/')) throw new Error('no target');
      for (const ev of body.events ?? []) track(ev.name, ev.props);
      if (body.next.startsWith('/login/verify/continue')) onExpired();
      else window.location.assign(body.next);
    } catch {
      // Fall back to the plain post: the server answers it with a redirect.
      form.submit();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Heading level={1} size="m">
        Continue to Crawlmouse.
      </Heading>
      <p className={styles.lead}>This link signs you in once. Continue to open your dashboard.</p>
      <form method="post" action="/login/verify" onSubmit={submit} className={styles.actions}>
        <Button type="submit" variant="primary" disabled={busy}>
          Continue
        </Button>
      </form>
    </>
  );
}

function Expired() {
  const ids = useId();
  const turnstile = useTurnstile();
  const [outcome, setOutcome] = useState<SendOutcome | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = (e.currentTarget.elements.namedItem('email') as HTMLInputElement).value.trim();
    setBusy(true);
    setOutcome(await sendLink({ email, turnstileToken: turnstile.spend() }));
    setBusy(false);
  }

  const refused = outcome !== null && outcome !== 'sent';
  return (
    <>
      <Heading level={1} size="m">
        This link has been used or has expired.
      </Heading>
      <p className={styles.lead}>
        Sending a new one replaces it; it works for {AUTH_LINK_MINUTES} minutes.
      </p>
      <form
        className={styles.form}
        aria-label="Send a new sign-in link"
        noValidate
        onSubmit={submit}
      >
        <Field
          id={`${ids}-email`}
          name="email"
          label="Email"
          type="email"
          placeholder="you@company.com"
          autoComplete="email"
          invalid={outcome === 'invalid_email'}
          describedBy={refused ? `${ids}-error` : undefined}
        />
        {turnstile.widget}
        <Button type="submit" variant="primary" disabled={busy || turnstile.waiting}>
          Send a new link
        </Button>
        <p id={`${ids}-error`} className={styles.error} role="alert">
          {refused ? SEND_COPY[outcome] : null}
        </p>
        <p className={styles.message} role="status">
          {outcome === 'sent'
            ? `Sent. Check your email; the new link works for ${AUTH_LINK_MINUTES} minutes.`
            : null}
        </p>
      </form>
    </>
  );
}
