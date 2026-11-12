/**
 * The unsubscribe link alert and summary mail carry (D7): the page `/unsubscribe` on crawlmouse.com
 * with the seam's signed token for one seat and one kind. Workstream A builds the page and its own
 * `unsubscribeUrl` in lib/v2/mail; this is the one place C's mail gets the URL from, so it can be
 * pointed at A's helper when the two are merged.
 */
import { SITE_ORIGIN } from '../mail/templates/alert';
import { signUnsubscribe } from '../mail/unsubscribe-token';
import type { UnsubscribeKind } from '../mail/types';

export function unsubscribeLink(
  secret: string,
  seatId: string,
  kind: UnsubscribeKind,
  now: Date,
): string {
  return `${SITE_ORIGIN}/unsubscribe?t=${signUnsubscribe(secret, seatId, kind, now)}`;
}
