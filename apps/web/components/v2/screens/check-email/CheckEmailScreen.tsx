'use client';

import { useEffect, useState } from 'react';
import {
  ALERTS_SENDER,
  AUTH_LINK_MINUTES,
  FIRST_AUDIT_MINUTES,
  RESEND_HINT_MINUTES,
  SIGNIN_SENDER,
} from '@/lib/auth/constants';
import { maskEmail } from '@/lib/auth/mask-email';
import { ANONYMOUS_VISIBLE_MS } from '@/lib/v2/view/result';
import { Button } from '../../Button';
import { Card } from '../../Card';
import { Heading } from '../../Heading';
import { PageShell } from '../../PageShell';
import layout from '../../layout.module.css';
import { cadenceOf, trialDays } from '../signup/door-copy';
import { readPending, SEND_COPY, type LinkRequest } from '../signup/send-link';
import { useLinkSender, VERIFYING_COPY } from '../signup/useLinkSender';
import { LiveRegion } from '../signup/LiveRegion';
import { numberWord } from '@/lib/v2/words';
import styles from './Door.module.css';

export type CheckEmailKind = 'signin' | 'named-site' | 'from-audit';

/** How long an anonymous audit stays visible, in hours (FACTS: 24). */
const ANONYMOUS_VISIBLE_HOURS = ANONYMOUS_VISIBLE_MS / 3_600_000;

/** "a minute" and "15 minutes", as the locked copy writes them. */
const minutes = (n: number, article: boolean) =>
  n === 1 ? (article ? 'a minute' : '1 minute') : `${n} minutes`;

/**
 * Check your email (CC-25), from Final-CheckEmail (a Keep) and Final-CheckEmail-NoAudit (a sign-up
 * naming a site), and the sign-in-only variant. The page holds no secret and never sees the link's
 * token. The address comes from this tab's sessionStorage (the form put it there; it is never in
 * the URL), masked; without it the sentence names none. `email` fixes it for previews.
 */
export function CheckEmailScreen({
  kind,
  site,
  pipeline,
  email: fixedEmail,
}: {
  kind: CheckEmailKind;
  /** A hostname, already validated by the route; null for the sign-in kind. */
  site: string | null;
  pipeline: boolean;
  email?: string;
}) {
  const [pending, setPending] = useState<LinkRequest | null>(
    fixedEmail ? { email: fixedEmail } : null,
  );
  useEffect(() => {
    if (!fixedEmail) setPending(readPending());
  }, [fixedEmail]);
  const sender = useLinkSender();
  // The page says to wait a minute before sending again: the button waits that long after the page
  // opens and after each link it sends.
  const [canResend, setCanResend] = useState(false);
  const sent = sender.state === 'sent';
  useEffect(() => {
    setCanResend(false);
    const t = window.setTimeout(() => setCanResend(true), RESEND_HINT_MINUTES * 60_000);
    return () => window.clearTimeout(t);
  }, [sent]);
  const masked = pending ? maskEmail(pending.email) : null;
  const fromAudit = kind === 'from-audit';
  const goBack = () => window.history.back();

  const back = fromAudit ? (
    <Button variant="quiet" size="sm" onClick={goBack}>
      Back to the audit
    </Button>
  ) : (
    <Button variant="quiet" size="sm" href="/signup">
      Back
    </Button>
  );

  const refused = sender.state in SEND_COPY ? (sender.state as keyof typeof SEND_COPY) : null;
  return (
    <PageShell header="app" footer={false} actions={back}>
      <main className={`${layout.wrap} ${styles.main}`}>
        <section className={styles.column}>
          <Heading level={1} size="m">
            Check your email.
          </Heading>
          <p className={styles.lead}>
            We sent a sign-in link{' '}
            {masked ? (
              <>
                to <span className={styles.addressStrong}>{masked}</span>{' '}
              </>
            ) : null}
            from <span className={styles.address}>{SIGNIN_SENDER}</span>. It works once, for{' '}
            {minutes(AUTH_LINK_MINUTES, false)}, on any device; sending it again replaces it.
          </p>

          {kind === 'signin' ? null : (
            <Card className={styles.card}>
              <div className={styles.cardTitle}>
                {fromAudit
                  ? 'Opening the link keeps the audit, if the account has room for another site.'
                  : `Opening the link creates your account, with ${trialDays} of Pro if it is your first trial, or signs you in to the one you have.`}
              </div>
              <p className={styles.cardBody}>
                {fromAudit && pipeline ? (
                  <>
                    From then on, {site} is re-checked {cadenceOf('pro')} for {trialDays} if it is
                    your first trial, and {cadenceOf('free')} after; if a check finds a change, the
                    note comes from <span className={styles.mono}>{ALERTS_SENDER}</span>. Until you
                    open it, the audit stays at its {ANONYMOUS_VISIBLE_HOURS}-hour link.
                  </>
                ) : fromAudit ? (
                  <>
                    Until you open it, the audit of {site} stays at its {ANONYMOUS_VISIBLE_HOURS}
                    -hour link.
                  </>
                ) : pipeline ? (
                  <>
                    The first audit of <span className={styles.monoStrong}>{site}</span> starts the
                    moment you open it, about {numberWord(FIRST_AUDIT_MINUTES)} minutes, if the
                    account has room for another site; after that it is re-checked{' '}
                    {cadenceOf('pro')} for {trialDays} if it is your first trial and{' '}
                    {cadenceOf('free')} after that; if a check finds a change, the note comes from{' '}
                    <span className={styles.mono}>{ALERTS_SENDER}</span>.
                  </>
                ) : (
                  <>
                    <span className={styles.monoStrong}>{site}</span> is added to your account when
                    you open it, if the account has room for another site.
                  </>
                )}
              </p>
            </Card>
          )}

          <div className={styles.rows}>
            <div className={styles.rowLine}>
              <span>Nothing after {minutes(RESEND_HINT_MINUTES, true)}? Check spam first.</span>
              <Button
                variant="quiet"
                size="sm"
                disabled={
                  !canResend ||
                  !pending ||
                  sender.state === 'verifying' ||
                  sender.state === 'sending'
                }
                onClick={() => pending && sender.request(pending)}
              >
                Send the link again
              </Button>
            </div>
            {sender.widget}
            <LiveRegion
              role="alert"
              className={styles.error}
              text={refused ? SEND_COPY[refused] : null}
            />
            <LiveRegion
              role="status"
              className={styles.message}
              text={
                sender.state === 'sent'
                  ? 'Sent again. The earlier link no longer works.'
                  : sender.state === 'verifying'
                    ? VERIFYING_COPY
                    : null
              }
            />
            <div className={styles.rowLine}>
              <span>Wrong address?</span>
              {fromAudit ? (
                <Button variant="quiet" size="sm" onClick={goBack}>
                  Use a different email
                </Button>
              ) : (
                <Button variant="quiet" size="sm" href="/signup">
                  Use a different email
                </Button>
              )}
            </div>
          </div>

          <div className={styles.closing}>
            You can close this tab.{' '}
            {kind === 'signin'
              ? 'The link signs you in and opens your dashboard.'
              : `Opened in this browser, the link signs you in and keeps ${fromAudit ? 'this audit' : site} in your account, if the account has room for another site.`}{' '}
            If the link has expired, the sign-in page offers a new one.
          </div>
        </section>
      </main>
    </PageShell>
  );
}
