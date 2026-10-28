'use client';

import { useEffect, useState } from 'react';
import { Button } from '../../Button';
import { Field } from '../../Field';
import layout from '../../layout.module.css';
import styles from './ResultScreen.module.css';

export type KeepState = 'waiting' | 'open' | 'dismissed';

/** How far the reader scrolls before the bar appears on a page long enough to scroll. */
const REVEAL_AFTER_PX = 420;

/**
 * The one account ask on the result page. It waits until the reader scrolls (or the page is too
 * short to scroll), can be dismissed to a one-line expiry notice, and opens again from any link to
 * #keep. Sticky on desktop, in the flow on phones.
 */
export function KeepBar({
  domain,
  expires,
  initial,
}: {
  domain: string;
  /** When the anonymous result expires, as a timestamp (never a countdown). */
  expires: string;
  /** Fix the state, for previews and tests; omitted, the bar follows the reader. */
  initial?: KeepState;
}) {
  const [state, setState] = useState<KeepState>(initial ?? 'waiting');

  useEffect(() => {
    if (initial) return;
    const check = () => {
      const doc = document.documentElement;
      const cannotScroll = doc.scrollHeight - window.innerHeight < 240;
      if (cannotScroll || window.scrollY > REVEAL_AFTER_PX) {
        setState((s) => (s === 'waiting' ? 'open' : s));
      }
    };
    const reveal = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target.closest('a[href="#keep"]') : null;
      if (target) setState('open');
    };
    window.addEventListener('scroll', check, { passive: true });
    document.addEventListener('click', reveal);
    const t = window.setTimeout(check, 50);
    return () => {
      window.removeEventListener('scroll', check);
      document.removeEventListener('click', reveal);
      window.clearTimeout(t);
    };
  }, [initial]);

  return (
    <div id="keep" className={`${layout.wrap} ${styles.keepWrap}`} data-v2-keep={state}>
      {state === 'open' ? (
        <div className={`${layout.row} ${styles.bar}`}>
          <div className={styles.barText}>
            <div className={styles.barTitle}>
              Keep this audit. We&apos;ll re-check {domain} monthly and show you what changed.
            </div>
            <div className={styles.barSub}>
              One email creates a free account and starts 14 days of Pro. Otherwise this page is
              kept until {expires}.
            </div>
          </div>
          {/* Not wired to an account yet. POST, and stopped here, so an email never lands in a URL. */}
          <form
            className={`${layout.row} ${styles.barForm}`}
            aria-label="Keep this audit"
            method="post"
            onSubmit={(e) => e.preventDefault()}
          >
            <Field
              id="save-email"
              name="email"
              label="Email"
              hideLabel
              type="email"
              placeholder="you@company.com"
              autoComplete="email"
              className={styles.barInput}
            />
            <Button type="submit" variant="inverse" className={styles.barButton}>
              Keep it
            </Button>
            <Button
              variant="quiet"
              className={`${styles.barButton} ${styles.barQuiet} ${styles.barNotNow}`}
              onClick={() => setState('dismissed')}
            >
              Not now
            </Button>
          </form>
        </div>
      ) : state === 'dismissed' ? (
        <div className={`${layout.row} ${styles.bar} ${styles.barMin}`}>
          <span>Not kept. This page expires {expires}.</span>
          <Button
            variant="quiet"
            size="sm"
            className={styles.barQuiet}
            onClick={() => setState('open')}
          >
            Keep this audit
          </Button>
        </div>
      ) : null}
    </div>
  );
}
