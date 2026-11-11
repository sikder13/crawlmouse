'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../Button';
import { Field } from '../../Field';
import { StatusPill } from '../../StatusPill';
import layout from '../../layout.module.css';
import styles from './CrawlScreen.module.css';

/**
 * The first email ask, a convenience while the crawl runs. What the email does is said exactly
 * (FACTS J7, and the owner's ruling on D8): it opens the result for 30 days, and nothing else.
 * Once the page has hydrated, a submit sends nothing and the address stays on this page. Before
 * then the browser would post the form back to this preview page, whose route reads no request
 * body. Focus follows the change: to the confirmation once sent, back to the field after "Wrong
 * address?".
 *
 * On a real check's screen `send` posts the address (app/audit/[id]/_crawl/LiveCrawl.tsx), the
 * confirmation waits for its answer, and a refusal is said under the field.
 */
export const RESULT_EMAIL_DOES = 'That email opens the result for 30 days, and nothing else.';

const FIELD_ID = 'w-email';

/** What became of an address that was sent: stored, or why it was not. */
export type EmailOutcome = 'stored' | 'ended' | 'limited' | 'failed';
export type SendEmail = (email: string) => Promise<EmailOutcome>;

const REFUSED: Record<Exclude<EmailOutcome, 'stored'>, string> = {
  ended: 'This audit has already ended. Reload the page to see how.',
  limited: 'Too many addresses were sent from here today. Try again tomorrow.',
  failed: 'That did not go through. Try again.',
};

export interface EmailAskProps {
  /** Sends the address; without it the address stays on the page. */
  send?: SendEmail;
  /** What the address is used for. */
  does?: string;
}

export function EmailAsk({ send: post, does = RESULT_EMAIL_DOES }: EmailAskProps = {}) {
  const errorId = useId();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sentRef = useRef<HTMLSpanElement>(null);
  // Set by the handler that changes what is shown; the effect moves focus once it is on screen.
  const focusNext = useRef<'sent' | 'field' | null>(null);
  useEffect(() => {
    if (focusNext.current === 'sent') sentRef.current?.focus();
    if (focusNext.current === 'field') document.getElementById(FIELD_ID)?.focus();
    focusNext.current = null;
  }, [sentTo]);

  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem('email') as HTMLInputElement;
    const value = input.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError('Enter an email address, like you@company.com.');
      input.focus();
      return;
    }
    setError(null);
    if (post) {
      const outcome = await post(value).catch((): EmailOutcome => 'failed');
      if (outcome !== 'stored') {
        setError(REFUSED[outcome]);
        return;
      }
    }
    focusNext.current = 'sent';
    setSentTo(value);
  }

  return (
    <div className={styles.ask}>
      {sentTo === null ? (
        <>
          <div className={styles.askTitle}>
            Don&apos;t want to wait? We&apos;ll email you the result when it&apos;s done.
          </div>
          <div className={styles.askSub}>{does}</div>
          <form
            className={`${layout.row} ${styles.askForm}`}
            aria-label="Email me the result"
            method="post"
            noValidate
            onSubmit={(e) => void send(e)}
          >
            {/* The field with its error under it; the alert region is there, empty, from the start. */}
            <div className={styles.askField}>
              <Field
                id={FIELD_ID}
                name="email"
                label="Email"
                hideLabel
                type="email"
                placeholder="you@company.com"
                autoComplete="email"
                className={styles.askInput}
                invalid={error !== null}
                describedBy={error ? errorId : undefined}
              />
              <p id={errorId} role="alert" className={styles.askError} data-v2-addition="">
                {error}
              </p>
            </div>
            <Button type="submit" variant="inverse" className={styles.askButton}>
              Email me the result
            </Button>
          </form>
        </>
      ) : (
        <>
          <div className={`${layout.row} ${styles.sent}`}>
            <StatusPill state="ok">address noted</StatusPill>
            <span
              ref={sentRef}
              tabIndex={-1}
              className={`${styles.askTitle} ${styles.focusTarget}`}
            >
              We&apos;ll email the result to <span className={layout.mono}>{sentTo}</span> when
              it&apos;s done.
            </span>
          </div>
          <div className={styles.askSub}>
            {does} You can close this tab.{' '}
            <Button
              variant="quiet"
              size="sm"
              className={styles.askQuiet}
              onClick={() => {
                focusNext.current = 'field';
                setSentTo(null);
              }}
            >
              Wrong address?
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
