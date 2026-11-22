'use client';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import posthog from 'posthog-js';
import {
  clearAnalyticsStorage,
  shouldShowConsentBanner,
  consentDecisionCookie,
  consentDecisionFromCookie,
  CONSENT_DECISION_STORAGE_KEY,
  CONSENT_DENIED_EVENT,
  CONSENT_GRANTED_EVENT,
  CONSENT_OPEN_EVENT,
} from '@/lib/consent';
import styles from './CookieConsent.module.css';

/**
 * Geo-gated analytics consent banner. Shown ONLY to visitors whose region requires prior opt-in
 * (cm_consent_required=1, set by middleware) and who have not yet decided. Until they choose,
 * instrumentation-client does not start PostHog, so nothing non-essential is stored or sent. The decision
 * logic is the pure, unit-tested shouldShowConsentBanner(); this component is the thin UI shell.
 */
export function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  // The control it was opened from: focus goes into the bar then, and back to it on closing. Shown
  // by itself on a first visit, the bar leaves focus where the visitor has it.
  const opener = useRef<HTMLElement | null>(null);

  const close = () => {
    setVisible(false);
    opener.current?.focus();
    opener.current = null;
  };

  // While open, the page keeps room for the bar, so the end of the page can be scrolled clear of it.
  useLayoutEffect(() => {
    if (!visible || !bar.current) return;
    const el = bar.current;
    const before = document.body.style.paddingBottom;
    const reserve = () => {
      document.body.style.paddingBottom = `${el.offsetHeight}px`;
    };
    reserve();
    window.addEventListener('resize', reserve);
    if (opener.current) el.querySelector('button')?.focus();
    return () => {
      window.removeEventListener('resize', reserve);
      document.body.style.paddingBottom = before;
    };
  }, [visible]);

  useEffect(() => {
    const stored = localStorage.getItem(CONSENT_DECISION_STORAGE_KEY);
    if (shouldShowConsentBanner(document.cookie, stored)) {
      setVisible(true);
    }
    // A decision made before the cookie existed is copied to it, so the server reads it too.
    if (
      (stored === 'granted' || stored === 'denied') &&
      consentDecisionFromCookie(document.cookie) !== stored
    ) {
      document.cookie = consentDecisionCookie(stored);
    }
    // Re-open on demand (footer "Cookie settings") so any visitor can change or WITHDRAW a prior
    // decision as easily as they gave it (GDPR Art. 7(3)) — works regardless of region/decision.
    const open = () => {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setVisible(true);
    };
    window.addEventListener(CONSENT_OPEN_EVENT, open);
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, open);
  }, []);

  if (!visible) return null;

  const decide = (granted: boolean) => {
    try {
      const decision = granted ? 'granted' : 'denied';
      localStorage.setItem(CONSENT_DECISION_STORAGE_KEY, decision);
      document.cookie = consentDecisionCookie(decision);
      if (granted) {
        // Before PostHog has started there is nothing to opt in, and the SDK's opt-in would write
        // to storage: the grant event below starts it (instrumentation-client.ts).
        if (posthog.__loaded) {
          posthog.set_config({
            disable_persistence: false,
            opt_out_capturing_by_default: false,
            disable_surveys: false,
          });
          posthog.opt_in_capturing();
        }
        window.dispatchEvent(new Event(CONSENT_GRANTED_EVENT));
      } else {
        if (posthog.__loaded) {
          posthog.opt_out_capturing();
          // Surveys skip an opted-out visitor only in cookieless mode, so they are switched off
          // here. With persistence off and opted-out as the default, the removal below holds.
          posthog.set_config({
            disable_surveys: true,
            disable_persistence: true,
            opt_out_capturing_by_default: true,
          });
        }
        clearAnalyticsStorage(document, [window.localStorage, window.sessionStorage]);
        window.dispatchEvent(new Event(CONSENT_DENIED_EVENT));
      }
    } catch {
      /* noop */
    }
    close();
  };

  // Escape leaves the choice unmade: nothing is recorded, and analytics stay as they were.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };

  return (
    <div
      ref={bar}
      role="dialog"
      aria-label="Analytics consent"
      className={styles.bar}
      onKeyDown={onKeyDown}
    >
      <div className={styles.inner}>
        <p className={styles.text}>
          We use privacy-friendly analytics (PostHog) to make Crawlmouse better. Allow non-essential
          analytics? You can change your mind anytime &mdash; see our{' '}
          <a href="/privacy">Privacy Policy</a>.
        </p>
        <div className={styles.actions}>
          <button type="button" onClick={() => decide(false)} className={styles.choice}>
            Decline
          </button>
          <button type="button" onClick={() => decide(true)} className={styles.choice}>
            Allow analytics
          </button>
        </div>
      </div>
    </div>
  );
}
