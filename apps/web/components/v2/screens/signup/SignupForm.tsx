'use client';

import { useCallback, useId, type FormEvent } from 'react';
import { hostFromSiteInput } from '@/lib/auth/site-host';
import { Button } from '../../Button';
import { Field } from '../../Field';
import { emailKindsSentence, siteHelper } from './door-copy';
import { browserZone, rememberPending, SEND_COPY, type LinkRequest } from './send-link';
import { useLinkSender, type SendState } from './useLinkSender';
import fieldStyles from '../../Field.module.css';
import styles from './Signup.module.css';

export type SignupFormState = Extract<
  SendState,
  'idle' | 'verifying' | 'sending' | 'rate_limited' | 'invalid_site'
>;

/** Where Check-email goes after a sent link: the kind, and the site when one was named. */
export function checkEmailHref(body: LinkRequest): string {
  const host = body.site ? hostFromSiteInput(body.site) : null;
  return host
    ? `/check-email?kind=named-site&site=${encodeURIComponent(host)}`
    : '/check-email?kind=signin';
}

/**
 * The Sign-up form. It posts JSON to /api/auth/magic-link (never a query string), keeps what a
 * resend needs in sessionStorage, and moves on to Check-email. Error and status text each have a
 * region from the start, empty until used, so a screen reader is told when text arrives.
 */
export function SignupForm({
  pipeline,
  initial,
}: {
  pipeline: boolean;
  initial?: SignupFormState;
}) {
  const ids = useId();
  const onSent = useCallback((body: LinkRequest) => {
    rememberPending(body);
    window.location.assign(checkEmailHref(body));
  }, []);
  const sender = useLinkSender(onSent);
  const state = sender.state === 'idle' && initial ? initial : sender.state;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget.elements;
    const email = (form.namedItem('email') as HTMLInputElement).value.trim();
    const site = (form.namedItem('site') as HTMLInputElement).value.trim();
    sender.request({ email, ...(site ? { site } : {}), tz: browserZone() });
  }

  const refused = state in SEND_COPY ? (state as keyof typeof SEND_COPY) : null;
  const busy = state === 'verifying' || state === 'sending';
  return (
    <form className={styles.form} aria-label="Create your account" noValidate onSubmit={submit}>
      <Field
        id={`${ids}-email`}
        name="email"
        label="Email"
        type="email"
        placeholder="you@company.com"
        autoComplete="email"
        required
        invalid={refused === 'invalid_email'}
        describedBy={refused === 'invalid_email' ? `${ids}-error` : undefined}
      />
      <label htmlFor={`${ids}-site`} className={styles.label}>
        First site to audit <span className={styles.mut}>· optional, you can add it after</span>
      </label>
      <input
        id={`${ids}-site`}
        name="site"
        type="text"
        inputMode="url"
        autoComplete="url"
        placeholder="yourdomain.com"
        className={`${fieldStyles.input} ${styles.siteInput}`}
        aria-invalid={refused === 'invalid_site' || undefined}
        aria-describedby={`${ids}-site-help${refused === 'invalid_site' ? ` ${ids}-error` : ''}`}
      />
      <div id={`${ids}-site-help`} className={styles.help}>
        {siteHelper(pipeline)}
      </div>
      {sender.widget}
      <Button type="submit" variant="primary" disabled={busy} className={styles.submit}>
        {state === 'sending' ? 'Sending…' : 'Send my sign-in link'}
      </Button>
      <p id={`${ids}-error`} className={styles.error} role="alert" data-v2-addition="">
        {refused ? SEND_COPY[refused] : null}
      </p>
      <p className={styles.status} role="status" data-v2-addition="">
        {state === 'verifying' ? 'One check that you are a person, then the link is sent.' : null}
      </p>
      <p className={styles.fine}>
        {emailKindsSentence()}{' '}
        <a href="/privacy" className={styles.underline}>
          Privacy
        </a>
      </p>
    </form>
  );
}
