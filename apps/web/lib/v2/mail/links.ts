/**
 * The links of the check-notify, account-link, invitation, client-report and unsubscribe mail are
 * built here, from values this code checked (D3): our origin, a path we serve, and an id or token of
 * a shape we know. The alert and
 * weekly-summary templates build their page links in templates/alert.ts (`pageUrl`, `SITE_ORIGIN`, the
 * same origin and the same id check); their senders pass in the unsubscribe link `unsubscribeLinks`
 * builds here (lib/v2/monitor/functions.ts).
 * Which targets each template's HTML holds is what its tests assert, with templates/inspect.ts.
 */
import { auditHref } from '../view/audit-hrefs';
import { LINK_FLOWS, type LinkFlow } from '../account/link-cookie';
import { isToken } from '../account/tokens';
import { signUnsubscribe } from './unsubscribe-token';
import type { UnsubscribeKind } from './types';

/** Where every link in our mail points. Production's origin, as v1's mail did (`inngest/notify.ts`). */
export const MAIL_ORIGIN = 'https://crawlmouse.com';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** An absolute link to one of our pages; `path` is a literal of ours, starting with `/`. */
export function mailUrl(path: `/${string}`): string {
  return `${MAIL_ORIGIN}${path}`;
}

/** The page a check is read at: the audit route, whose id is the capability (CC-22b). */
export function checkUrl(checkId: string): string {
  if (!UUID.test(checkId)) throw new RangeError('not a check id');
  return mailUrl(auditHref(checkId) as `/${string}`);
}

/** The kinds of `account_tokens` row (027b), and the link route each lands on. */
export const ACCOUNT_LINK_FLOW = {
  email_change: 'emailChange',
  email_change_undo: 'emailUndo',
  delete_confirm: 'deleteConfirm',
  delete_restore: 'restore',
} as const satisfies Record<string, LinkFlow>;
export type AccountLinkKind = keyof typeof ACCOUNT_LINK_FLOW;

/** An emailed account link: the flow's page with the token as its last segment (`[token]/route.ts`). */
export function accountLinkUrl(kind: AccountLinkKind, token: string): string {
  if (!isToken(token)) throw new RangeError('not an account link token');
  return mailUrl(`${LINK_FLOWS[ACCOUNT_LINK_FLOW[kind]].page}/${token}`);
}

/** A seat's invitation (CC-31 D3): the link route that moves the token into the invitation's cookie. */
export function seatInviteUrl(token: string): string {
  if (!isToken(token)) throw new RangeError('not an invitation token');
  return mailUrl(`${LINK_FLOWS.invite.page}/${token}`);
}

/**
 * The links a client report schedule mails its recipient (CC-31 D8, spec 31 §10): the confirmation
 * of the address, and the pause, which is also the report mail's List-Unsubscribe target. Each
 * token is minted in SQL in the shape an account link's is.
 */
export function reportConfirmUrl(token: string): string {
  if (!isToken(token)) throw new RangeError('not a confirmation token');
  return mailUrl(`/s/confirm/${token}`);
}

/**
 * "Don't ask me again", in the mail that asks to confirm: the confirmation link's own token under
 * another path, which records a refusal where the first confirms.
 */
export function reportDeclineUrl(token: string): string {
  if (!isToken(token)) throw new RangeError('not a confirmation token');
  return mailUrl(`/s/decline/${token}`);
}

export function reportPauseUrl(token: string): string {
  if (!isToken(token)) throw new RangeError('not a pause token');
  return mailUrl(`/s/pause/${token}`);
}

/** A share link's token (CC-31 D7): 16 random bytes in base64url, 22 characters. */
const SHARE_TOKEN = /^[A-Za-z0-9_-]{22}$/;

/** A shared report: `/s/<token>`. */
export function sharedReportUrl(token: string): string {
  if (!SHARE_TOKEN.test(token)) throw new RangeError('not a share token');
  return mailUrl(`/s/${token}`);
}

export interface UnsubscribeLinks {
  /** The page a person opens from the footer: it shows the choice and changes nothing (GET). */
  page: string;
  /** The RFC 8058 one-click target for `List-Unsubscribe`: a mail client POSTs to it. */
  oneClick: string;
}

/**
 * One seat's unsubscribe links for one kind (D7, Q11), both carrying the same token, signed now. An
 * alert or summary email puts `page` in its footer (`layout`'s `unsubscribeUrl`) and `oneClick` in
 * its headers (`unsubscribeHeaders({ url: oneClick })`, headers.ts).
 */
export function unsubscribeLinks(
  secret: string,
  seatId: string,
  kind: UnsubscribeKind,
  now: Date,
): UnsubscribeLinks {
  const t = signUnsubscribe(secret, seatId, kind, now);
  return { page: mailUrl(`/unsubscribe?t=${t}`), oneClick: mailUrl(`/api/unsubscribe?t=${t}`) };
}

/** The footer's unsubscribe page for one seat and one kind; `unsubscribeLinks` gives both links. */
export function unsubscribeUrl(
  secret: string,
  seatId: string,
  kind: UnsubscribeKind,
  now: Date,
): string {
  return unsubscribeLinks(secret, seatId, kind, now).page;
}
