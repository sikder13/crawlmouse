/**
 * The product events CC-26b's routes send from the server (D11). Names and properties are ARCH-2
 * §8's, and each name is in `FUNNEL_EVENTS` (`SERVER_EVENTS` is checked against it by the compiler),
 * so the catalogue stays one list.
 *
 * What is sent. The distinct id is the account's id, with `$process_person_profile: false`; no email,
 * host, IP or header value is put in properties. Nothing is sent when the request comes from a
 * region where analytics needs prior consent (the `cm_consent_required` cookie the middleware sets),
 * because the visitor's decision is held in their browser and the server cannot read it
 * (questions.md Q10). A send that fails is dropped: an event never fails the action it records.
 */
import { consentRequiredFromCookie } from '../../consent';
import type { FunnelEvent } from '../../analytics-events';

/** The names, each required to be in `FUNNEL_EVENTS` by `satisfies`. */
export const SERVER_EVENTS = [
  'site_added',
  'check_started',
  'fix_marked_done',
  'fix_closed',
  'trial_started',
] as const satisfies readonly FunnelEvent[];

export type ServerEventName = (typeof SERVER_EVENTS)[number];

export interface ServerEvents extends Record<ServerEventName, object> {
  site_added: { n: number };
  check_started: { trigger: 'manual' | 'fix_recheck' | 'first_audit' };
  fix_marked_done: { type: string };
  fix_closed: { type: string; checksToClose: number };
  trial_started: { kind: 'pro'; variant: 'no_card' };
}

export interface Capture {
  <E extends ServerEventName>(
    event: E,
    accountId: string,
    properties: ServerEvents[E],
  ): Promise<void>;
}

const POSTHOG_CAPTURE_URL = 'https://us.i.posthog.com/i/v0/e/';

/** Sends to PostHog's capture API with the project key; nothing without one. */
export const posthogCapture: Capture = async (event, accountId, properties) => {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!apiKey) return;
  await fetch(POSTHOG_CAPTURE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      event,
      distinct_id: `account:${accountId}`,
      properties: { ...properties, $process_person_profile: false },
    }),
  }).catch(() => undefined);
};

/** The capture for one request: a no-op when its region needs prior consent. */
export function captureFor(req: Request, send: Capture = posthogCapture): Capture {
  if (consentRequiredFromCookie(req.headers.get('cookie'))) return async () => undefined;
  return async (event, accountId, properties) => {
    try {
      await send(event, accountId, properties);
    } catch {
      // Dropped: see the header.
    }
  };
}
