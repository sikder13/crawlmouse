import * as Sentry from '@sentry/nextjs';
import { scrubDoorSecrets } from './lib/auth/sentry-scrub';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  // The sign-in link's token and a Keep's claim target never leave the server (lib/auth/sentry-scrub.ts).
  beforeSend: (event) => scrubDoorSecrets(event),
  beforeSendTransaction: (event) => scrubDoorSecrets(event),
});
