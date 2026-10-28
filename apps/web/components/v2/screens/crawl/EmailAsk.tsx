'use client';

import { useId, useState, type FormEvent } from 'react';
import { Button } from '../../Button';
import { Field } from '../../Field';
import { StatusPill } from '../../StatusPill';
import layout from '../../layout.module.css';
import styles from './CrawlScreen.module.css';

/**
 * The first email ask, a convenience while the crawl runs. What the email does is said exactly
 * (FACTS J7, and the owner's ruling on D8): it opens the result for 30 days, and nothing else. In
 * the preview it sends nothing; the address stays on this page.
 */
export const RESULT_EMAIL_DOES = 'That email opens the result for 30 days, and nothing else.';

export function EmailAsk() {
  const errorId = useId();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem('email') as HTMLInputElement;
    const value = input.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError('Enter an email address, like you@company.com.');
      input.focus();
      return;
    }
    setError(null);
    setSentTo(value);
  }

  return (
    <div className={styles.ask}>
      {sentTo === null ? (
        <>
          <div className={styles.askTitle}>
            Don&apos;t want to wait? We&apos;ll email you the result when it&apos;s done.
          </div>
          <div className={styles.askSub}>{RESULT_EMAIL_DOES}</div>
          <form
            className={`${layout.row} ${styles.askForm}`}
            aria-label="Email me the result"
            method="post"
            noValidate
            onSubmit={send}
          >
            <Field
              id="w-email"
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
            <Button type="submit" variant="inverse" className={styles.askButton}>
              Email me the result
            </Button>
          </form>
          <p
            id={errorId}
            role="alert"
            className={styles.askError}
            hidden={error === null}
            data-v2-addition=""
          >
            {error}
          </p>
        </>
      ) : (
        <>
          <div className={`${layout.row} ${styles.sent}`}>
            <StatusPill state="ok">on its way</StatusPill>
            <span className={styles.askTitle}>
              We&apos;ll email the result to <span className={layout.mono}>{sentTo}</span> when
              it&apos;s done.
            </span>
          </div>
          <div className={styles.askSub}>
            {RESULT_EMAIL_DOES} You can close this tab.{' '}
            <Button
              variant="quiet"
              size="sm"
              className={styles.askQuiet}
              onClick={() => setSentTo(null)}
            >
              Wrong address?
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
