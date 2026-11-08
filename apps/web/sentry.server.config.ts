import * as Sentry from '@sentry/nextjs';
import { sentryServerOptions } from './lib/auth/sentry-scrub';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  // No cookie, request body, sign-in token or claim target leaves the server in an event, and no
  // cookie in a span attribute (lib/auth/sentry-scrub.ts).
  ...sentryServerOptions(Sentry.requestDataIntegration),
});
