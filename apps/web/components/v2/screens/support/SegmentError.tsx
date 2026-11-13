'use client';

import * as Sentry from '@sentry/nextjs';
import { usePathname, useRouter } from 'next/navigation';
import { startTransition, useEffect, useState } from 'react';
import { idsInPath, supportMailto } from '../../../../lib/v2/support/mailto';
import { ErrorScreen } from './ErrorScreen';

export interface SegmentErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * The error boundary of a signed-in segment (`error.tsx`, CC-33 D5): it reports the error to Sentry
 * and shows the error screen with the event's id, and a support link carrying the page's path, the
 * ids in it and that id. A client boundary holds no account id (questions Q5).
 *
 * Retrying refreshes the route before resetting the boundary. In Next 15 `reset` only clears the
 * boundary's state (next/dist/client/components/error-boundary.js, `this.reset`), re-rendering the
 * server components' payload the browser already holds, so an error a server component threw would
 * throw again; `router.refresh()` requests the route from the server and re-renders its server
 * components (Next 15's useRouter reference). Both run in one transition.
 */
export function SegmentError({ error, reset }: SegmentErrorProps) {
  const [eventId, setEventId] = useState<string | null>(null);
  const path = usePathname();
  const router = useRouter();
  useEffect(() => {
    setEventId(Sentry.captureException(error));
  }, [error]);
  const support = supportMailto({ topic: 'error', path: path ?? '', ...idsInPath(path), eventId });
  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });
  return <ErrorScreen eventId={eventId} support={support} onRetry={retry} />;
}
