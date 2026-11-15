'use client';

import { ErrorScreen } from '../../../../components/v2/screens/support/ErrorScreen';
import { supportMailto } from '../../../../lib/v2/support/mailto';

/** A sample Sentry event id and the site page it was raised on. */
const EVENT_ID = '4f0b6c1d2e3a4b5c6d7e8f9a0b1c2d3e';
const PATH = '/sites/0b0e7a52-5f0b-4b53-9c0e-0d4a3a1f2c11';

/** The error screen as a site page's boundary shows it, once Sentry has given the event's id. */
export function ErrorPreview() {
  return (
    <ErrorScreen
      eventId={EVENT_ID}
      support={supportMailto({
        topic: 'error',
        path: PATH,
        siteId: PATH.split('/')[2],
        eventId: EVENT_ID,
      })}
      onRetry={() => window.location.reload()}
    />
  );
}
