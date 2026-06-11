'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

// Last-resort boundary: renders only when the ROOT layout/template itself throws on the client,
// so it must ship its own <html>/<body> (the normal layout is gone). It reports the error to
// Sentry — without this, client-side React render errors in the App Router are invisible in prod
// (server-side RSC/route errors are already covered by instrumentation.ts onRequestError).
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#fbf7ef',
          color: '#1a1a1a',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
          textAlign: 'center',
          padding: '2rem',
        }}
      >
        <div style={{ maxWidth: '28rem' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 0.5rem' }}>
            Something went wrong
          </h1>
          <p style={{ margin: '0 0 1.5rem', opacity: 0.7, lineHeight: 1.5 }}>
            An unexpected error interrupted the page. The team has been notified.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              cursor: 'pointer',
              border: 'none',
              borderRadius: '0.5rem',
              padding: '0.625rem 1.25rem',
              fontSize: '0.95rem',
              fontWeight: 600,
              background: '#1a1a1a',
              color: '#fbf7ef',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
