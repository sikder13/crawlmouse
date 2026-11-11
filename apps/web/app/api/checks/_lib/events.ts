/**
 * The two product events of the public check flow that the server sends (CC-22b D12): a check
 * started, and a check's end reached a viewer's progress stream. Both names are in `FUNNEL_EVENTS`.
 *
 * What is sent. The check is named by `checkRef`, a hash, because its id is the capability to read
 * it; the distinct id is that hash, with `$process_person_profile: false`. Nothing is sent when the
 * request's `cm_consent_required` cookie is `1`: the visitor's decision is held in their browser,
 * where the server cannot read it. A send that fails is dropped, so an event does not fail the
 * request it records.
 */
import { consentRequiredFromCookie } from '../../../../lib/consent';
import type { FunnelEvent } from '../../../../lib/analytics-events';
import { checkRef } from '../../../../lib/v2/pipeline/public';
import type { Check } from '@crawlmouse/types/v2';

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

export type PublicServerEvent = keyof PublicServerEvents & FunnelEvent;

export interface CaptureBody {
  event: PublicServerEvent;
  distinct_id: string;
  properties: Record<string, unknown>;
}

export type SendCapture = (body: CaptureBody) => Promise<void>;

const POSTHOG_CAPTURE_URL = 'https://us.i.posthog.com/i/v0/e/';

/** Posts to PostHog's capture endpoint with the project key; sends nothing without one. */
export const posthogSend: SendCapture = async (body) => {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!apiKey) return;
  await fetch(POSTHOG_CAPTURE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, ...body }),
  });
};

export async function capturePublicEvent<E extends PublicServerEvent>(
  req: Request,
  event: E,
  checkId: string,
  properties: PublicServerEvents[E],
  send: SendCapture = posthogSend,
): Promise<void> {
  if (consentRequiredFromCookie(req.headers.get('cookie'))) return;
  const ref = checkRef(checkId);
  try {
    await send({
      event,
      distinct_id: `check:${ref}`,
      properties: { ...properties, check_ref: ref, $process_person_profile: false },
    });
  } catch {
    // Dropped: see the header.
  }
}
