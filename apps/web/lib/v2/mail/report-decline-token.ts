/**
 * The token of an address's "Don't ask me again" link (CC-31 D8, owner ruling on Q42). Like the
 * pause link's it is derived, not random: an HMAC-SHA256 under `EMAIL_LINK_SECRET` of the site and
 * the address a request to confirm goes to, so each request mailed to one address carries the same
 * link and the link of an earlier mail still answers. The database holds its sha256 with the
 * site's entry for that address (`sites.report_refusals`, `issue_recipient_confirmation`).
 * Another address of the same site, and the same address of another site, get another token, and
 * it is not the pause link's token. Form: 43 base64url characters, as `/s/decline/[token]` reads.
 */
import { createHmac } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function reportDeclineToken(secret: string, siteId: string, recipient: string): string {
  if (!UUID.test(siteId)) throw new RangeError('not a site id');
  return createHmac('sha256', secret)
    .update(`report_decline:${siteId}:${recipient.trim().toLowerCase()}`)
    .digest('base64url');
}
