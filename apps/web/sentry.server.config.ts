import * as Sentry from '@sentry/nextjs';
import { sentryServerOptions } from './lib/auth/sentry-scrub';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  // No cookie, sign-in token or claim target leaves the server (lib/auth/sentry-scrub.ts).
  ...sentryServerOptions(Sentry.requestDataIntegration),
});
