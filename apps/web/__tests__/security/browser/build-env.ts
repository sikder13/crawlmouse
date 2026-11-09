/**
 * The placeholders CI's build job builds with (.github/workflows/ci.yml, job `build`), so these checks
 * can name the values the build baked in: Cloudflare's documented always-pass Turnstile test sitekey, a
 * PostHog key no project has, and a Sentry DSN on a `.invalid` host. The browser checks answer the
 * PostHog and Sentry requests themselves; the middleware's sampled refusal events still go, server
 * side, to PostHog's capture endpoint, which refuses the key.
 */
export const BUILD_ENV = {
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  NEXT_PUBLIC_POSTHOG_KEY: 'ci-placeholder-posthog-key',
  NEXT_PUBLIC_SENTRY_DSN: 'https://ciplaceholder@o0.ingest.sentry.invalid/0',
} as const;

export const SENTRY_ORIGIN = 'https://o0.ingest.sentry.invalid';
export const CSP_REPORT_URL = `${SENTRY_ORIGIN}/api/0/security/?sentry_key=ciplaceholder`;
