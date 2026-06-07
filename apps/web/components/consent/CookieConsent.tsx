'use client';
import { useEffect, useState } from 'react';
import posthog from 'posthog-js';
import { shouldShowConsentBanner, CONSENT_DECISION_STORAGE_KEY, CONSENT_OPEN_EVENT } from '@/lib/consent';

/**
 * Geo-gated analytics consent banner. Shown ONLY to visitors whose region requires prior opt-in
 * (cm_consent_required=1, set by middleware) and who have not yet decided. Until they choose,
 * instrumentation-client keeps PostHog opted out, so nothing non-essential fires. The decision
 * logic is the pure, unit-tested shouldShowConsentBanner(); this component is the thin UI shell.
 */
export function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (shouldShowConsentBanner(document.cookie, localStorage.getItem(CONSENT_DECISION_STORAGE_KEY))) {
      setVisible(true);
    }
    // Re-open on demand (footer "Cookie settings") so any visitor can change or WITHDRAW a prior
    // decision as easily as they gave it (GDPR Art. 7(3)) — works regardless of region/decision.
    const open = () => setVisible(true);
    window.addEventListener(CONSENT_OPEN_EVENT, open);
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, open);
  }, []);

  if (!visible) return null;

  const decide = (granted: boolean) => {
    try {
      localStorage.setItem(CONSENT_DECISION_STORAGE_KEY, granted ? 'granted' : 'denied');
      if (granted) posthog.opt_in_capturing();
      else posthog.opt_out_capturing();
    } catch {
      /* noop */
    }
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Analytics consent"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-oat bg-cream/95 px-4 py-4 shadow-lg backdrop-blur"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink/80">
          We use privacy-friendly analytics (PostHog) to make Crawlmouse better. Allow non-essential
          analytics? You can change your mind anytime &mdash; see our{' '}
          <a className="text-peach underline" href="/privacy">Privacy Policy</a>.
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => decide(false)}
            className="rounded-lg border border-oat px-4 py-2 text-sm font-semibold text-ink hover:bg-oat/50"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={() => decide(true)}
            className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-cream hover:bg-ink/90"
          >
            Allow analytics
          </button>
        </div>
      </div>
    </div>
  );
}
