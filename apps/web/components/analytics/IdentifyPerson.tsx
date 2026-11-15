'use client';
import { useEffect } from 'react';
import posthog from 'posthog-js';
import { firstTouchFromCookies } from '@/lib/analytics/first-touch';
import { identifyPerson, type PersonTraits } from '@/lib/analytics/person';
import { CONSENT_GRANTED_EVENT } from '@/lib/consent';

/**
 * Identifies this browser as the signed-in user (lib/analytics/person.ts) when it mounts and again
 * on the consent banner's grant; renders nothing. Does nothing while PostHog has not started (no
 * project key, or /internal) or capture is opted out.
 */
export function IdentifyPerson({ traits }: { traits: PersonTraits }) {
  useEffect(() => {
    const identify = () => {
      if (!posthog.__loaded) return;
      identifyPerson(posthog, traits, firstTouchFromCookies(document.cookie));
    };
    identify();
    window.addEventListener(CONSENT_GRANTED_EVENT, identify);
    return () => window.removeEventListener(CONSENT_GRANTED_EVENT, identify);
  }, [traits]);
  return null;
}
