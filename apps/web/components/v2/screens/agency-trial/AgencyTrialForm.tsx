'use client';

import { useId, useState, type FormEvent } from 'react';
import { AGENCY_TRIAL_COPY as COPY } from '@/lib/v2/copy/agency-trial';
import type { AgencyTrialForm as FormView } from '@/lib/v2/view/agency-trial';
import { Button } from '../../Button';
import fieldStyles from '../../Field.module.css';
import styles from './AgencyTrial.module.css';

/** A refusal is its code, and for `trial_refused` the reason `trialRefusal` gave (CC-03). */
export type TrialFormState = 'idle' | 'sending' | { error: string; reason?: string };

/**
 * The line a refusal shows: for `trial_refused`, the state machine's reason itself (D3); for any
 * other code its sentence, and the generic one for a code with none.
 */
function refusalText(state: TrialFormState): string | null {
  if (typeof state !== 'object') return null;
  if (state.error === 'trial_refused' && state.reason) return state.reason;
  return COPY.errors[state.error] ?? COPY.errors.failed!;
}

/**
 * The step before Checkout (FACTS J15 as overruled): the agency name, the first client site and the
 * consent checkbox. It posts JSON to /api/agency-trial and follows the `{url}` it answers to Stripe's
 * page; a refusal is shown here (`refusalText`). Without script the same form posts itself, with
 * `consent=true`, and the route answers with a redirect.
 */
export function AgencyTrialForm({
  view,
  initial = 'idle',
}: {
  view: FormView;
  initial?: TrialFormState;
}) {
  const ids = useId();
  const [state, setState] = useState<TrialFormState>(initial);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget.elements;
    const value = (name: string) => (form.namedItem(name) as HTMLInputElement).value.trim();
    setState('sending');
    try {
      const res = await fetch('/api/agency-trial', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          consent: (form.namedItem('consent') as HTMLInputElement).checked,
          agencyName: value('agencyName'),
          site: value('site'),
          interval: view.interval,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        url?: unknown;
        error?: unknown;
        reason?: unknown;
      };
      if (res.ok && typeof body.url === 'string') {
        window.location.assign(body.url);
        return;
      }
      setState({
        error: typeof body.error === 'string' ? body.error : 'failed',
        ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
      });
    } catch {
      setState({ error: 'failed' });
    }
  }

  const error = refusalText(state);
  return (
    <form
      className={styles.form}
      method="post"
      action="/api/agency-trial"
      aria-label={COPY.title}
      onSubmit={submit}
    >
      {view.email ? (
        <div className={styles.signedIn}>
          {COPY.signedInAs} <strong>{view.email}</strong>
        </div>
      ) : null}
      <label htmlFor={`${ids}-name`} className={styles.label}>
        {COPY.agencyName} <span className={styles.mut}>· {COPY.agencyNameHint}</span>
      </label>
      <input
        id={`${ids}-name`}
        name="agencyName"
        type="text"
        autoComplete="organization"
        placeholder="Summit Digital"
        maxLength={120}
        required
        defaultValue={view.defaults.agencyName}
        className={`${fieldStyles.input} ${styles.wide}`}
      />
      <label htmlFor={`${ids}-site`} className={styles.label}>
        {COPY.site} <span className={styles.mut}>· {COPY.siteHint}</span>
      </label>
      <input
        id={`${ids}-site`}
        name="site"
        type="text"
        inputMode="url"
        autoComplete="url"
        placeholder={COPY.sitePlaceholder}
        required
        defaultValue={view.defaults.site}
        className={`${fieldStyles.input} ${styles.wide}`}
      />
      <input type="hidden" name="interval" value={view.interval} />
      <div className={styles.help}>
        {view.intervalText}{' '}
        <a className={styles.underline} href={view.otherIntervalHref}>
          {COPY.switchInterval}
        </a>
      </div>
      <label htmlFor={`${ids}-consent`} className={styles.consent}>
        <input id={`${ids}-consent`} name="consent" type="checkbox" value="true" required />
        <span>{view.consent}</span>
      </label>
      <div className={styles.help}>{COPY.card}</div>
      <Button
        type="submit"
        variant="primary"
        className={styles.submit}
        disabled={state === 'sending'}
      >
        {COPY.submit}
      </Button>
      <p className={styles.error} role="alert">
        {error}
      </p>
      <p className={styles.fine}>
        {COPY.fine}{' '}
        <a className={styles.underline} href="/terms">
          {COPY.terms}
        </a>{' '}
        ·{' '}
        <a className={styles.underline} href="/privacy">
          {COPY.privacy}
        </a>
      </p>
    </form>
  );
}
