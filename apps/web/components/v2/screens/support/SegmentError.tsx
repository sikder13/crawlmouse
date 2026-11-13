'use client';

import * as Sentry from '@sentry/nextjs';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
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
 */
export function SegmentError({ error, reset }: SegmentErrorProps) {
  const [eventId, setEventId] = useState<string | null>(null);
  const path = usePathname();
  useEffect(() => {
    setEventId(Sentry.captureException(error));
  }, [error]);
  const support = supportMailto({ topic: 'error', path: path ?? '', ...idsInPath(path), eventId });
  return <ErrorScreen eventId={eventId} support={support} onRetry={reset} />;
}
