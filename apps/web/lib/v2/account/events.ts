/**
 * The product events CC-26b's routes send from the server (D11). Names and properties are ARCH-2
 * §8's (`check_started` in the one shape the product uses, `{trigger, check_ref}`), and each name is
 * in `FUNNEL_EVENTS` (`SERVER_EVENTS` is checked against it by the compiler).
 *
 * What is sent: the distinct id is the account's id; no email, host, IP or header value is put in
 * properties; a check is named by its `check_ref`, never its id. The sender and the consent rule are
 * the product's one sender (`captureServerEvent`) and `serverCaptureAllowed`, which reads the
 * visitor's decision from the `cm_consent` cookie: nothing is sent when it says denied, or when there
 * is no decision and the region needs prior consent.
 */
import type { FunnelEvent } from '../../analytics-events';
import { captureServerEvent, checkRef, serverCaptureAllowed } from './server-capture-interim';

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

export type Sender = (
  event: string,
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

/** The capture for one request: a no-op when its consent cookies do not allow server events. */
export function captureFor(req: Request, send: Sender = captureServerEvent): Capture {
  if (!serverCaptureAllowed(req.headers.get('cookie'))) return async () => undefined;
  return (event, accountId, properties) => send(event, `account:${accountId}`, properties);
}

/** `check_started`'s properties for a check: its trigger and its reference, not its id. */
export const checkStarted = (
  trigger: ServerEvents['check_started']['trigger'],
  checkId: string,
): ServerEvents['check_started'] => ({ trigger, check_ref: checkRef(checkId) });
