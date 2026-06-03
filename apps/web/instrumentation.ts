import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.server.config');
  }
}

// Reports uncaught errors from nested React Server Components / route handlers (the 5xx signal).
export const onRequestError = Sentry.captureRequestError;
