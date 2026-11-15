/**
 * The server's sender of product events to PostHog (`check_started`, `check_finished` and the
 * other funnel events): the check routes send through `captureServerEvent`. The security refusal
 * event has a sender of its own (lib/security/refusal-event.ts), which posts to the same endpoint.
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
 *
 * Internal accounts (CC-33 D1). An event about an account marked internal carries `internal: true`.
 * Whether it is about one is read from its distinct id and its `accountId`, when the caller passes
 * one (`isInternalEvent`, lib/v2/ops/internal-marker.ts), only for an event consent lets through.
 * The property is this module's: a caller's own `internal` is dropped.
 */
import type { FunnelEvent } from './analytics-events';
import { serverCaptureAllowed } from './consent';
import { isInternalEvent, type InternalLookup } from './v2/ops/internal-marker';

export interface ServerEvent {
  event: FunnelEvent;
  /** Who or what the event is about: an account, a check reference. Not an email. */
  distinctId: string;
  /** The account the event is about, when its distinct id does not name it. */
  accountId?: string | null;
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
  { event, distinctId, accountId, properties = {} }: ServerEvent,
  send: SendCapture = posthogSend,
  lookup?: InternalLookup,
): Promise<void> {
  if (!serverCaptureAllowed(cookieHeader)) return;
  const own = Object.fromEntries(Object.entries(properties).filter(([k]) => k !== 'internal'));
  const internal = await isInternalEvent(distinctId, accountId, lookup);
  try {
    await send({
      event,
      distinct_id: distinctId,
      properties: {
        ...own,
        ...(internal ? { internal: true } : {}),
        $process_person_profile: false,
        $geoip_disable: true,
      },
    });
  } catch {
    console.error(`analytics: server capture of ${event} failed`);
  }
}
