'use client';

import { useEffect, useState } from 'react';
import posthog from 'posthog-js';
import { CONSENT_DENIED_EVENT, CONSENT_GRANTED_EVENT } from '../../lib/consent';

/** The attribute PostHog's feedback survey opens on (scripts/ops/posthog, `[cm]` Feedback). */
export const FEEDBACK_ATTRIBUTE = 'data-cm-feedback';

const capturing = () => posthog.__loaded && !posthog.has_opted_out_capturing();

/**
 * The account shell's "Feedback" button (CC-41 D8a): PostHog's feedback survey opens on a click of
 * the element carrying FEEDBACK_ATTRIBUTE. It is rendered only while PostHog runs and capture is not
 * opted out (read after mount, and again on the consent banner's grant and decline), so a visitor for
 * whom no survey can open has no button.
 */
export function FeedbackButton({ className }: { className?: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const read = () => setShown(capturing());
    read();
    window.addEventListener(CONSENT_GRANTED_EVENT, read);
    window.addEventListener(CONSENT_DENIED_EVENT, read);
    return () => {
      window.removeEventListener(CONSENT_GRANTED_EVENT, read);
      window.removeEventListener(CONSENT_DENIED_EVENT, read);
    };
  }, []);
  if (!shown) return null;
  return (
    <button type="button" className={className} {...{ [FEEDBACK_ATTRIBUTE]: '' }}>
      Feedback
    </button>
  );
}
