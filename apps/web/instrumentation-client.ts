import posthog from 'posthog-js';
import * as Sentry from '@sentry/nextjs';
import { beforeSendSampler } from '@/lib/analytics';
import { sentryBrowserOptions } from '@/lib/auth/sentry-scrub';
import { rememberFirstTouch } from '@/lib/analytics/first-touch';
import {
  analyticsMayStart,
  clearAnalyticsStorage,
  consentRequiredFromCookie,
  CONSENT_DECISION_STORAGE_KEY,
  CONSENT_GRANTED_EVENT,
  surveysOffAtStart,
} from '@/lib/consent';

// Sentry (client) — moved here from sentry.client.config.ts per @sentry/nextjs v8+ guidance.
// With no DSN set (local/build), Sentry.init is a safe no-op.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
  // The id in an `/audit/<id>` or `/checks/<id>` address is written out of each event and
  // transaction before it is sent (lib/auth/sentry-scrub.ts).
  ...sentryBrowserOptions(),
});
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

// PostHog — through the same-origin /ingest proxy (ad-blocker resilient); session replay OFF until
// an error occurs (privacy-masked). Sampling drops noisy autocapture (cost control #6). Not started
// on the support console, /internal (owner ruling, CC-33; __tests__/console-no-analytics.dom.test.ts).
if (
  typeof window !== 'undefined' &&
  process.env.NEXT_PUBLIC_POSTHOG_KEY &&
  !/^\/internal(\/|$)/.test(window.location.pathname)
) {
  const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const storedDecision = () => {
    try {
      return localStorage.getItem(CONSENT_DECISION_STORAGE_KEY);
    } catch {
      return null;
    }
  };
  const mayStart = () => analyticsMayStart(document.cookie, storedDecision());

  // Consent gate (F-048): PostHog is not started at all until it may be. Its opt-out flag stops
  // capture only: `init` itself writes a cookie and storage and calls /flags/ and config.js.
  const startPostHog = () => {
    if (posthog.__loaded || !mayStart()) return;
    posthog.init(posthogKey, {
      // Always the proxy, whatever NEXT_PUBLIC_POSTHOG_HOST says (F-049).
      api_host: '/ingest',
      ui_host: 'https://us.posthog.com',
      person_profiles: 'always',
      capture_pageview: true,
      capture_pageleave: true,
      // Add-ons no insight reads (scripts/ops/posthog/spec.ts): each is a script on every page.
      capture_dead_clicks: false,
      capture_performance: false,
      // posthog-js skips surveys for an opted-out visitor only in cookieless mode, which this is not.
      disable_surveys: surveysOffAtStart(
        consentRequiredFromCookie(document.cookie),
        storedDecision(),
      ),
      disable_session_recording: true, // do not record by default
      session_recording: { maskAllInputs: true, maskTextSelector: '[data-ph-mask]' },
      before_send: beforeSendSampler,
    });
  };
  if (mayStart()) startPostHog();
  else {
    // What an earlier version wrote before anyone chose.
    clearAnalyticsStorage(document, [window.localStorage, window.sessionStorage]);
  }

  // Error-only replay: start recording the moment something throws, so we capture the lead-up
  // to a real bug without recording every healthy session. Never record a visitor PostHog is not
  // running for, or who opted out, so replay honors the same consent gate as capture.
  const startReplay = () => {
    try {
      if (!posthog.__loaded || posthog.has_opted_out_capturing?.()) return;
      posthog.startSessionRecording();
    } catch {
      /* noop */
    }
  };
  window.addEventListener('error', startReplay, { once: true });
  window.addEventListener('unhandledrejection', startReplay, { once: true });

  // First-touch attribution (lib/analytics/first-touch.ts): the `cm_ft` cookie, written once, for
  // the page this load landed on, now when analytics may run, or on the consent banner's grant.
  const landing = {
    href: window.location.href,
    referrer: document.referrer,
    ownHost: window.location.hostname,
  };
  const firstTouch = () =>
    rememberFirstTouch({
      document,
      // Not the SDK's own answer: before `init` it reports "not opted out".
      optedOut: () => !mayStart(),
      page: landing,
      now: () => new Date(),
    });
  firstTouch();
  // On the banner's grant: start PostHog, then the first-touch cookie.
  window.addEventListener(CONSENT_GRANTED_EVENT, () => {
    startPostHog();
    firstTouch();
  });
}
