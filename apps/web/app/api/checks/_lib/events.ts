/**
 * The two product events of the public check flow that the server sends (CC-22b D12): a check
 * started, and a check's end reached a viewer's progress stream. A typed wrapper over the server's
 * one sender (`lib/analytics-server.ts`), which applies the visitor's consent and drops a failed
 * send.
 *
 * The check is named by `checkRef`, a hash, because its id is the capability to read it: the
 * distinct id is `check:{ref}` and the properties carry `check_ref`.
 */
import type { Check } from '@crawlmouse/types/v2';
import { captureServerEvent, type SendCapture } from '../../../../lib/analytics-server';
import { checkRef } from '../../../../lib/v2/pipeline/public';

export interface PublicServerEvents {
  check_started: { trigger: Check['trigger'] };
  check_finished: {
    trigger: Check['trigger'];
    status: 'finished' | 'partial' | 'failed';
    pages: number;
    durationMs: number;
  };
}

export type PublicServerEvent = keyof PublicServerEvents;

export async function capturePublicEvent<E extends PublicServerEvent>(
  req: Request,
  event: E,
  checkId: string,
  properties: PublicServerEvents[E],
  send?: SendCapture,
): Promise<void> {
  const ref = checkRef(checkId);
  await captureServerEvent(
    req.headers.get('cookie'),
    { event, distinctId: `check:${ref}`, properties: { ...properties, check_ref: ref } },
    send,
  );
}
