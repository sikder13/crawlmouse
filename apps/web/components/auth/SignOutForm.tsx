'use client';
import type { ReactNode } from 'react';
import posthog from 'posthog-js';

/**
 * The sign-out form: a native POST to /api/auth/logout, as before CC-41. On submit it first resets
 * PostHog (CC-41 D1), so the next person on this browser is not joined to this one; the POST then
 * goes on whether or not that reset ran, and a reset that throws is not reported as an error.
 */
export function SignOutForm({ className, children }: { className?: string; children: ReactNode }) {
  const reset = () => {
    try {
      if (posthog.__loaded) posthog.reset();
    } catch {
      /* the sign-out goes on */
    }
  };
  return (
    <form action="/api/auth/logout" method="post" className={className} onSubmit={reset}>
      {children}
    </form>
  );
}
