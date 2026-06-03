import posthog from 'posthog-js';
import * as Sentry from '@sentry/nextjs';
import { beforeSendSampler } from '@/lib/analytics';

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
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    // `||` (not `??`) so an empty-string env value (e.g. `NEXT_PUBLIC_POSTHOG_HOST=` from the
    // example file) also falls back to the proxy — `??` would keep the '' and break ingestion.
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || '/ingest',
    ui_host: 'https://us.posthog.com',
    person_profiles: 'always',
    capture_pageview: true,
    capture_pageleave: true,
    disable_session_recording: true, // do not record by default
    session_recording: { maskAllInputs: true, maskTextSelector: '[data-ph-mask]' },
    before_send: beforeSendSampler,
  });
  // Error-only replay: start recording the moment something throws, so we capture the lead-up
  // to a real bug without recording every healthy session.
  const startReplay = () => {
    try {
      posthog.startSessionRecording();
    } catch {
      /* noop */
    }
  };
  window.addEventListener('error', startReplay, { once: true });
  window.addEventListener('unhandledrejection', startReplay, { once: true });
}
