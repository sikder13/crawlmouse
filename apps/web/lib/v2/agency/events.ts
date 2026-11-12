/**
 * The product events the agency's workspace sends from the server (CC-31 D10). Each name is in
 * `FUNNEL_EVENTS` (`AGENCY_EVENTS` is checked against it by the compiler).
 *
 * What is sent: the distinct id is the account's id, and the properties are the typed ones below
 * (a role, a report's kind and format, counts), which hold no address, host or token. They go through
 * `captureServerEvent` (lib/analytics-server.ts), which reads the visitor's consent from the
 * request's cookie header and drops a send that fails.
 */
import type { Report } from '@crawlmouse/types/v2';
import type { FunnelEvent } from '../../analytics-events';
import { captureServerEvent, type SendCapture } from '../../analytics-server';

export const AGENCY_EVENTS = [
  'seat_invited',
  'seat_accepted',
  'report_generated',
  'report_downloaded',
  'report_shared',
  'share_link_opened',
  'proof_viewed',
  'first_client_added',
  'first_client_report_sent',
  'seats_bought',
] as const satisfies readonly FunnelEvent[];

export type AgencyEventName = (typeof AGENCY_EVENTS)[number];

type InvitedRole = 'account_manager' | 'developer';
type ReportProps = Pick<Report, 'kind' | 'format'>;

export interface AgencyEvents extends Record<AgencyEventName, object> {
  seat_invited: { role: InvitedRole; scoped: boolean };
  seat_accepted: { role: InvitedRole };
  report_generated: ReportProps;
  report_downloaded: ReportProps;
  report_shared: ReportProps;
  /** A share link was opened by someone holding it. */
  share_link_opened: ReportProps;
  /** A proof page was read: through a share link, or signed in. */
  proof_viewed: { via: 'share' | 'account' };
  first_client_added: Record<string, never>;
  first_client_report_sent: Record<string, never>;
  /** The quantities asked for on the subscription: extra seats and extra sites. */
  seats_bought: { seats: number; sites: number };
}

export interface AgencyCapture {
  <E extends AgencyEventName>(
    event: E,
    accountId: string,
    properties: AgencyEvents[E],
  ): Promise<void>;
}

/** The capture for one request: the product's sender, given the request's cookie header. */
export function agencyCaptureFor(req: Request, send?: SendCapture): AgencyCapture {
  const cookie = req.headers.get('cookie');
  return (event, accountId, properties) =>
    captureServerEvent(cookie, { event, distinctId: `account:${accountId}`, properties }, send);
}

/** The capture for a step with no request (a scheduled send): there is no cookie header to read. */
export function agencyCaptureWithoutRequest(send?: SendCapture): AgencyCapture {
  return (event, accountId, properties) =>
    captureServerEvent(null, { event, distinctId: `account:${accountId}`, properties }, send);
}
