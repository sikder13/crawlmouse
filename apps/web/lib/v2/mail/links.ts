/**
 * The links of the check-notify, account-link and unsubscribe mail are built here, from values this
 * code checked (D3): our origin, a path we serve, and an id or token of a shape we know. The alert and
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
