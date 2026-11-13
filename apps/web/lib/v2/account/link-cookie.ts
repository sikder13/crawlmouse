/**
 * The emailed links' token never stays in a page URL (plan-revision R3). The link is a route that
 * changes nothing: it puts the token in an HttpOnly cookie for its flow and answers 303 to the flow's
 * page, whose URL holds no token. The page renders from the cookie, and its form POSTs to the flow's
 * API route, which reads the token from the cookie, not from the URL or the body. So the token is in
 * no URL that page-view analytics, error reporting, a Referer or a request log records, apart from the
 * one request the link itself makes.
 */
import { isToken } from './tokens';

/** Each flow: its cookie, the page the link lands on, and the API route its form posts to. */
export const LINK_FLOWS = {
  emailChange: {
    cookie: 'cm_link_email',
    page: '/account/email',
    api: '/api/account/email/confirm',
  },
  emailUndo: {
    cookie: 'cm_link_email_undo',
    page: '/account/email-undo',
    api: '/api/account/email/undo',
  },
  deleteConfirm: {
    cookie: 'cm_link_delete',
    page: '/account/delete',
    api: '/api/account/delete/confirm',
  },
  restore: { cookie: 'cm_link_restore', page: '/account/restore', api: '/api/account/restore' },
  // A seat's invitation (CC-31 D3).
  invite: { cookie: 'cm_link_invite', page: '/invite', api: '/api/seats/accept' },
  // A client report's recipient: the confirmation link and the pause link (CC-31 D8).
  reportConfirm: {
    cookie: 'cm_link_report_confirm',
    page: '/s/confirm',
    api: '/api/report-files/confirm',
  },
  reportPause: {
    cookie: 'cm_link_report_pause',
    page: '/s/pause',
    api: '/api/report-files/pause',
  },
} as const;

export type LinkFlow = keyof typeof LINK_FLOWS;

/** Long enough to read the page and press the button; the token's own expiry is the database's. */
export const LINK_COOKIE_SECONDS = 600;

const NO_STORE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } as const;

function cookie(flow: LinkFlow, value: string, maxAge: number): string {
  // SameSite=Lax: the link arrives as a cross-site navigation from a mail client, and the page's own
  // form posts from our origin; Strict would drop it on the redirect that follows the link.
  return `${LINK_FLOWS[flow].cookie}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

/**
 * The link's GET: a token-shaped value goes into the flow's cookie; anything else sets nothing. Both
 * answer 303 to the page, which says when the link is not one it can use.
 */
export function landLink(origin: string, flow: LinkFlow, token: string): Response {
  const headers: Record<string, string> = {
    ...NO_STORE,
    Location: `${origin}${LINK_FLOWS[flow].page}`,
  };
  const res = new Response(null, { status: 303, headers });
  if (isToken(token)) res.headers.append('Set-Cookie', cookie(flow, token, LINK_COOKIE_SECONDS));
  return res;
}

/** The flow's token from a request's `Cookie` header, or null. */
export function linkToken(cookieHeader: string | null, flow: LinkFlow): string | null {
  for (const part of (cookieHeader ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === LINK_FLOWS[flow].cookie) {
      const token = value.join('=');
      return isToken(token) ? token : null;
    }
  }
  return null;
}

/** The `Set-Cookie` value that removes the flow's cookie, sent once its token is used. */
export const clearLinkCookie = (flow: LinkFlow): string => cookie(flow, '', 0);

export { NO_STORE as LINK_RESPONSE_HEADERS };
