/**
 * The server's one sender of product events to PostHog. Routes call `captureServerEvent`; none
 * builds a capture request of its own.
 *
 * What it sends: the event name, the caller's distinct id and properties, with
 * `$process_person_profile: false` (no person profile) and `$geoip_disable: true` (PostHog would
 * otherwise locate the event by the address the request came from, which is this server's). It is
 * given the request's `Cookie` header only, to read the visitor's consent, and puts nothing of the
 * request in the event. Callers pass no email and no host in `properties`.
 *
 * When it sends: if `serverCaptureAllowed` says the visitor's consent allows it and there is a
 * project key. A send that fails, or that PostHog has not answered in CAPTURE_TIMEOUT_MS, is logged
 * by event name, without the payload, and dropped: `captureServerEvent` resolves either way. The
 * check routes run it after their response (`after`, app/api/checks/route.ts and
 * app/api/checks/[id]/_lib/deps.ts), so the wait is not the visitor's.
 */
import type { FunnelEvent } from './analytics-events';
import { serverCaptureAllowed } from './consent';

export interface ServerEvent {
  event: FunnelEvent;
  /** Who or what the event is about: an account, a check reference. Not an email. */
  distinctId: string;
  properties?: Readonly<Record<string, unknown>>;
}

/** What is posted to PostHog's capture endpoint, less the project key. */
export interface CaptureBody {
  event: FunnelEvent;
  distinct_id: string;
  properties: Record<string, unknown>;
}

export type SendCapture = (body: CaptureBody) => Promise<void>;

const POSTHOG_CAPTURE_URL = 'https://us.i.posthog.com/i/v0/e/';

/** How long a capture waits for PostHog before the request is aborted. */
export const CAPTURE_TIMEOUT_MS = 2000;

/**
 * Posts to PostHog's capture endpoint with the project key; sends nothing without one. The request
 * is aborted, and so rejects, when PostHog has not answered in CAPTURE_TIMEOUT_MS.
 */
export const posthogSend: SendCapture = async (body) => {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!apiKey) return;
  const res = await fetch(POSTHOG_CAPTURE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, ...body }),
    signal: AbortSignal.timeout(CAPTURE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`capture answered ${res.status}`);
};

export async function captureServerEvent(
  cookieHeader: string | null,
  { event, distinctId, properties = {} }: ServerEvent,
  send: SendCapture = posthogSend,
): Promise<void> {
  if (!serverCaptureAllowed(cookieHeader)) return;
  try {
    await send({
      event,
      distinct_id: distinctId,
      properties: { ...properties, $process_person_profile: false, $geoip_disable: true },
    });
  } catch {
    console.error(`analytics: server capture of ${event} failed`);
  }
}
