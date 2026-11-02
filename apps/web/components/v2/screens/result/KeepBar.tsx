'use client';

import { useEffect, useState } from 'react';
import { Button } from '../../Button';
import { Field } from '../../Field';
import layout from '../../layout.module.css';
import styles from './ResultScreen.module.css';

export type KeepState = 'waiting' | 'open' | 'dismissed';

/** How far the reader scrolls before the bar appears on a page long enough to scroll. */
const REVEAL_AFTER_PX = 420;

/** The keep bar placed in a segment page's flow, after its evidence, with the page's own words. */
export interface InlineKeep {
  title: string;
  sub: string;
  /** The bar's button is the page's one orange element (FACTS: Changes has no other action). */
  primary?: boolean;
}

/**
 * The one account ask on a result or segment page. On the result page it waits until the reader
 * scrolls (or the page is too short to scroll), can be dismissed to a one-line expiry notice, and
 * opens again from any link to #keep; sticky on desktop, in the flow on phones. On a segment page
 * (`inline`) it sits open in the flow, after the evidence, as the locked segment pages place it.
 */
export function KeepBar({
  domain,
  expires,
  initial,
  inline,
}: {
  domain: string;
  /** When the anonymous result expires, as a timestamp, not a countdown. */
  expires: string;
  /** Fix the state, for previews and tests; omitted, the bar follows the reader. */
  initial?: KeepState;
  inline?: InlineKeep;
}) {
  const [state, setState] = useState<KeepState>(inline ? 'open' : (initial ?? 'waiting'));
  const Wrapper = inline ? 'section' : 'aside';

  useEffect(() => {
    if (initial || inline) return;
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
  }, [initial, inline]);

  return (
    // On the result page a landmark of its own: it sits outside main, and axe wants every word in
    // one. In a segment page's flow it is a section of main instead, since a complementary
    // landmark must not sit inside another.
    <Wrapper
      id="keep"
      aria-label="Keep this audit"
      className={inline ? styles.keepInline : `${layout.wrap} ${styles.keepWrap}`}
      data-v2-keep={state}
    >
      {state === 'open' ? (
        <div className={`${layout.row} ${styles.bar}`}>
          <div className={styles.barText}>
            <div className={styles.barTitle}>
              {inline ? (
                inline.title
              ) : (
                <>
                  Keep this audit. We&apos;ll re-check {domain} monthly and show you what changed.
                </>
              )}
            </div>
            <div className={styles.barSub}>
              {inline ? (
                inline.sub
              ) : (
                <>
                  One email creates a free account and starts 14 days of Pro. Otherwise this page is
                  kept until {expires}.
                </>
              )}
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
            <Button
              type="submit"
              variant={inline?.primary ? 'primary' : 'inverse'}
              className={styles.barButton}
            >
              Keep it
            </Button>
            {inline ? null : (
              <Button
                variant="quiet"
                className={`${styles.barButton} ${styles.barQuiet} ${styles.barNotNow}`}
                onClick={() => setState('dismissed')}
              >
                Not now
              </Button>
            )}
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
    </Wrapper>
  );
}
