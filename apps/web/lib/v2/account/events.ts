/**
 * The product events CC-26b's routes send from the server (D11). Names and properties are ARCH-2
 * §8's (`check_started` in the one shape the product uses, `{trigger, check_ref}`), and each name is
 * in `FUNNEL_EVENTS` (`SERVER_EVENTS` is checked against it by the compiler).
 *
 * What is sent: the distinct id is the account's id; no email, host, IP or header value is put in
 * properties; a check is named by its `check_ref`, never its id. They go through the product's one
 * server sender, `captureServerEvent` (lib/analytics-server.ts), which reads the visitor's consent
 * from the request's cookie header (`serverCaptureAllowed`) and drops a send that fails.
 */
import type { FunnelEvent } from '../../analytics-events';
import { captureServerEvent, type SendCapture } from '../../analytics-server';
import { checkRef } from '../pipeline/public';

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
  check_started: { trigger: 'manual' | 'fix_recheck' | 'first_audit'; check_ref: string };
  fix_marked_done: { type: string };
  fix_closed: { type: string; checksToClose: number };
  trial_started: { kind: 'pro'; variant: 'no_card' };
}

/** A sender keyed by event, distinct id and properties, as a step with no request uses one. */
export type Sender = (
  event: ServerEventName,
  distinctId: string,
  properties: Readonly<Record<string, unknown>>,
) => Promise<void>;

export interface Capture {
  <E extends ServerEventName>(
    event: E,
    accountId: string,
    properties: ServerEvents[E],
  ): Promise<void>;
}

/** The capture for one request: the product's sender, given the request's cookie header. */
export function captureFor(req: Request, send?: SendCapture): Capture {
  const cookie = req.headers.get('cookie');
  return (event, accountId, properties) =>
    captureServerEvent(cookie, { event, distinctId: `account:${accountId}`, properties }, send);
}

/**
 * The sender for a step with no request (the persist step's `fix_closed`): there is no cookie header,
 * so `serverCaptureAllowed` reads none (a known gap, docs/specs/v2/26b-dashboard-wiring.md).
 */
export const sendWithoutRequest: Sender = (event, distinctId, properties) =>
  captureServerEvent(null, { event, distinctId, properties });

/** `check_started`'s properties for a check: its trigger and its reference, not its id. */
export const checkStarted = (
  trigger: ServerEvents['check_started']['trigger'],
  checkId: string,
): ServerEvents['check_started'] => ({ trigger, check_ref: checkRef(checkId) });
