/**
 * The two product events of the public check flow that the server sends (CC-22b D12): a check
 * started, and a check's end reached a viewer's progress stream. A typed wrapper over the server's
 * sender of product events (`lib/analytics-server.ts`), which applies the visitor's consent and
 * drops a failed send.
 *
 * The check is named by `checkRef`, a hash, because its id is the capability to read it: the
 * properties carry `check_ref`. The distinct id is the visitor (CC-41 D1, `visitorDistinctId`): a
 * signed-in viewer's `users.id`, else the browser's PostHog id from the consented cookie, else
 * `check:{ref}`. That holds for these two server events. The browser's own events from an audit page carry the page's URL, which holds
 * the check id (instrumentation-client.ts: posthog-js with `capture_pageview`).
 */
import { after } from 'next/server';
import type { Check } from '@crawlmouse/types/v2';
import {
  captureServerEvent,
  visitorDistinctId,
  type SendCapture,
} from '../../../../lib/analytics-server';
import type { InternalLookup } from '../../../../lib/v2/ops/internal-marker';
import { checkRef } from '../../../../lib/v2/pipeline/public';

export interface PublicServerEvents {
  check_started: { trigger: Check['trigger'] };
  check_finished: {
    trigger: Check['trigger'];
    status: 'finished' | 'partial' | 'failed';
    pages: number;
    durationMs: number;
    /** A finished or partial check's Technical SEO score; null when that grade was refused. */
    seo?: number | null;
    /** Its AI readability total; null when `withheld`. */
    aiReadability?: number | null;
    withheld?: boolean;
  };
}

export type PublicServerEvent = keyof PublicServerEvents;

/** The sender and the internal-account lookup, for a test to replace. */
export interface CaptureWith {
  send?: SendCapture;
  lookup?: InternalLookup;
}

/**
 * Who the event is about. `accountId` is the account that keeps the check's site, or null for a check
 * no account keeps; it is what `captureServerEvent` reads to mark an event about an internal account
 * (CC-33 D1). `userId` is the signed-in visitor's `users.id`, or null.
 */
export interface PublicVisitor {
  accountId: string | null;
  userId: string | null;
}

export async function capturePublicEvent<E extends PublicServerEvent>(
  req: Request,
  event: E,
  checkId: string,
  properties: PublicServerEvents[E],
  { accountId, userId }: PublicVisitor,
  { send, lookup }: CaptureWith = {},
): Promise<void> {
  const ref = checkRef(checkId);
  const cookie = req.headers.get('cookie');
  await captureServerEvent(
    cookie,
    {
      event,
      distinctId: visitorDistinctId(cookie, userId, `check:${ref}`),
      accountId,
      properties: { ...properties, check_ref: ref },
    },
    send,
    lookup,
  );
}

/**
 * The capture handed to Next's `after`, so the response does not wait on PostHog. `after` throws
 * when Next gives it no request scope or no `waitUntil`; the capture is then awaited here, for at
 * most the sender's CAPTURE_TIMEOUT_MS, so the answer the caller is about to give still goes out.
 */
export async function capturePublicEventAfterResponse<E extends PublicServerEvent>(
  req: Request,
  event: E,
  checkId: string,
  properties: PublicServerEvents[E],
  visitor: PublicVisitor,
): Promise<void> {
  const capture = () => capturePublicEvent(req, event, checkId, properties, visitor);
  try {
    after(capture);
  } catch {
    await capture();
  }
}
