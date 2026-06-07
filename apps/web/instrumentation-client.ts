import posthog from 'posthog-js';
import * as Sentry from '@sentry/nextjs';
import { beforeSendSampler } from '@/lib/analytics';
import { consentRequiredFromCookie, CONSENT_DECISION_STORAGE_KEY } from '@/lib/consent';

// Sentry (client) — moved here from sentry.client.config.ts per @sentry/nextjs v8+ guidance.
// With no DSN set (local/build), Sentry.init is a safe no-op.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
});
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

// PostHog — reverse-proxied via /ingest (ad-blocker resilient); session replay OFF until an
// error occurs (privacy-masked). Sampling drops noisy autocapture (cost control #6).
if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_POSTHOG_KEY) {
  // Consent gate: in regions that require prior opt-in (cm_consent_required=1, set by middleware
  // from geo), hold ALL capture until the visitor agrees via the CookieConsent banner. Elsewhere
  // (and once granted) analytics load by default. A prior 'denied' decision also keeps us opted out.
  const consentRequired = consentRequiredFromCookie(document.cookie);
  const decision = localStorage.getItem(CONSENT_DECISION_STORAGE_KEY);
  const optOutByDefault = consentRequired && decision !== 'granted';

  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    // `||` (not `??`) so an empty-string env value (e.g. `NEXT_PUBLIC_POSTHOG_HOST=` from the
    // example file) also falls back to the proxy — `??` would keep the '' and break ingestion.
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || '/ingest',
    ui_host: 'https://us.posthog.com',
    person_profiles: 'always',
    capture_pageview: true,
    capture_pageleave: true,
    opt_out_capturing_by_default: optOutByDefault,
    disable_session_recording: true, // do not record by default
    session_recording: { maskAllInputs: true, maskTextSelector: '[data-ph-mask]' },
    before_send: beforeSendSampler,
  });
  // Error-only replay: start recording the moment something throws, so we capture the lead-up
  // to a real bug without recording every healthy session. Never record opted-out visitors
  // (e.g. EU/UK before consent), so replay honors the same consent gate as capture.
  const startReplay = () => {
    try {
      if (posthog.has_opted_out_capturing?.()) return;
      posthog.startSessionRecording();
    } catch {
      /* noop */
    }
  };
  window.addEventListener('error', startReplay, { once: true });
  window.addEventListener('unhandledrejection', startReplay, { once: true });
}
