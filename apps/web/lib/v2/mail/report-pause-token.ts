/**
 * The token of a client report schedule's pause link (CC-31 D8). It is derived, not random: an
 * HMAC-SHA256 under `EMAIL_LINK_SECRET` of the site and the address the reports go to, so each
 * report mailed to one contact carries the same link and the link of an earlier report still
 * pauses. The database holds its sha256 (`report_schedules.pause_token_hash`, `issue_report_pause`).
 * Another contact of the same site, and the same contact of another site, get another token.
 * Form: 43 base64url characters, as `/s/pause/[token]` reads.
 */
import { createHmac } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function reportPauseToken(secret: string, siteId: string, recipient: string): string {
  if (!UUID.test(siteId)) throw new RangeError('not a site id');
  return createHmac('sha256', secret)
    .update(`report_pause:${siteId}:${recipient.trim().toLowerCase()}`)
    .digest('base64url');
}
