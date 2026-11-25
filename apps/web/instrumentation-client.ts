import posthog from 'posthog-js';
import { beforeSendSampler } from '@/lib/analytics';
import { sentryBrowserOptions } from '@/lib/auth/sentry-scrub';
import {
  BROWSER_STORES,
  onSupportConsole,
  resumeAnalytics,
  stopAnalytics,
} from '@/lib/analytics/consent-control';
import { rememberFirstTouch } from '@/lib/analytics/first-touch';
import { configureSentry, routerTransitionStart, startSentryWhenIdle } from '@/lib/sentry-lazy';
import {
  analyticsMayStart,
  clearAnalyticsStorage,
  consentRequiredFromCookie,
  CONSENT_DECISION_STORAGE_KEY,
  CONSENT_DENIED_EVENT,
  posthogApiHost,
  recordedDecision,
  storedConsent,
  CONSENT_GRANTED_EVENT,
  surveysOffAtStart,
} from '@/lib/consent';
import { hasSessionCookie } from '@/lib/v2/session-header';
import { isOwnHost } from '@/lib/v2/agency/own-host';

// An agency's own host (Goal 1 row 25) serves its client's report and nothing else: no analytics
// and no session replay there.
const onPortalHost = typeof window !== 'undefined' && !isOwnHost(window.location.host);

// Sentry (client) — configured here, fetched when the browser is idle or on the first error, so it
// is not part of a page's first load (F-045, lib/sentry-lazy.ts). With no DSN set (local/build)
// nothing is fetched.
configureSentry({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: onPortalHost ? 0 : 1.0,
  // The id in an `/audit/<id>` or `/checks/<id>` address is written out of each event and
  // transaction before it is sent (lib/auth/sentry-scrub.ts).
  ...sentryBrowserOptions(),
});
if (typeof window !== 'undefined') startSentryWhenIdle(window);
export const onRouterTransitionStart = routerTransitionStart;

// PostHog — through the same-origin /ingest proxy (ad-blocker resilient); session replay OFF until
// an error occurs (privacy-masked). Sampling drops noisy autocapture (cost control #6). Not started
// on the support console, /internal (owner ruling, CC-33; __tests__/console-no-analytics.dom.test.ts).
if (
  typeof window !== 'undefined' &&
  process.env.NEXT_PUBLIC_POSTHOG_KEY &&
  !onPortalHost &&
  !/^\/internal(\/|$)/.test(window.location.pathname)
) {
  const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  // The console is checked each time, not only at load: Allow can come after a client navigation.
  const mayStart = () => !onSupportConsole() && analyticsMayStart(document.cookie, storedConsent());

  // Consent gate (F-048): PostHog is not started at all until it may be. Its opt-out flag stops
  // capture only: `init` itself writes a cookie and storage and calls /flags/ and config.js.
  const startPostHog = () => {
    if (posthog.__loaded || !mayStart()) return;
    posthog.init(posthogKey, {
      // The same-origin proxy, whatever NEXT_PUBLIC_POSTHOG_HOST says (F-049).
      api_host: posthogApiHost(process.env.NEXT_PUBLIC_POSTHOG_HOST),
      ui_host: 'https://us.posthog.com',
      person_profiles: 'always',
      capture_pageview: true,
      capture_pageleave: true,
      // Add-ons no insight reads (scripts/ops/posthog/spec.ts): each is a script on every page.
      capture_dead_clicks: false,
      capture_performance: false,
      // The project's heatmap setting would start them, and with them the dead-click add-on whatever
      // `capture_dead_clicks` says. A heatmap is keyed by page address, which can hold a check id.
      capture_heatmaps: false,
      // posthog-js skips surveys for an opted-out visitor only in cookieless mode, which this is not.
      disable_surveys: surveysOffAtStart(
        consentRequiredFromCookie(document.cookie),
        storedConsent(),
        hasSessionCookie(document.cookie),
      ),
      disable_session_recording: true, // do not record by default
      session_recording: { maskAllInputs: true, maskTextSelector: '[data-ph-mask]' },
      before_send: beforeSendSampler,
    });
  };
  if (mayStart()) startPostHog();
  else if (
    consentRequiredFromCookie(document.cookie) ||
    recordedDecision(document.cookie, storedConsent()) === 'denied'
  ) {
    // What an earlier version wrote before anyone chose. A page with no region cookie holds
    // analytics but removes nothing: it says nothing about this visitor.
    clearAnalyticsStorage(document, BROWSER_STORES);
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
  // A choice made in another tab of this site reaches this one, and the page's own listeners (the
  // Feedback button, IdentifyPerson, the grant listener above) hear it as they would here. It acts
  // on the recorded decision, not the event's value: a full store records it in the cookie alone,
  // and a late event may be older than the decision. A page restored from the back/forward cache
  // has missed the events, so it catches up the same way.
  const followRecordedDecision = () => {
    const decision = recordedDecision(document.cookie, storedConsent());
    const stopped = !posthog.__loaded || posthog.has_opted_out_capturing();
    if (decision === 'denied' && !stopped) {
      stopAnalytics(posthog);
      window.dispatchEvent(new Event(CONSENT_DENIED_EVENT));
    }
    if (decision === 'granted' && stopped) {
      resumeAnalytics(posthog);
      window.dispatchEvent(new Event(CONSENT_GRANTED_EVENT));
    }
  };
  window.addEventListener('storage', (e) => {
    if (e.key === CONSENT_DECISION_STORAGE_KEY) followRecordedDecision();
  });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) followRecordedDecision();
  });
}
