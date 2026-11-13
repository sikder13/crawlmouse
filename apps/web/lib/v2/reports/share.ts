/**
 * Share links (CC-31 D7; docs/specs/v2/31-agency.md §10): a link that opens one report for whoever
 * holds it, for 30 days, until it is revoked.
 *
 * The token is 16 random bytes in base64url, 22 characters. The database holds its sha256 and the
 * rules (migration 20261114000002, section B: `create_share_link`, `open_share_link`,
 * `read_share_link`, `revoke_share_links`); this file makes and hashes the token, and answers the
 * routes. The token is in one address only, the link's own (`/s/<token>`): a file is answered with a
 * redirect to a signed URL of the stored object, and a proof page with a redirect to
 * `/s/view/<report id>`, the token moved into an HttpOnly cookie scoped to that path.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Report } from '@crawlmouse/types/v2';
import { noticeTo, refuse, type RequestBody } from '../account/route';
import type { AgencyCapture } from '../agency/events';

// ─── the token ───────────────────────────────────────────────────────────────────────────────────

/** 16 random bytes, base64url: 22 characters, no padding. */
export function newShareToken(): string {
  return randomBytes(16).toString('base64url');
}

/** The shape `newShareToken` produces; anything else is refused before a database read. */
const SHARE_TOKEN = /^[A-Za-z0-9_-]{22}$/;

export const isShareToken = (value: unknown): value is string =>
  typeof value === 'string' && SHARE_TOKEN.test(value);

/** The stored form: sha256, lowercase hex (`share_links.token_hash`). */
export function hashShareToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

// ─── addresses, cookies and headers ──────────────────────────────────────────────────────────────

/** The link a person is given. */
export const shareUrl = (origin: string, token: string): string => `${origin}/s/${token}`;

/** Where a shared proof page is read: an address with the report's id and no token. */
export const shareViewPath = (reportId: string): string => `/s/view/${reportId}`;

/** The page the share forms are on. */
export const REPORTS_PAGE = '/reports';

/** A signed URL of a shared file lives this long, so a revoked link stops opening it within it. */
export const SIGNED_URL_SECONDS = 60;

/** Long enough to read the page; opening the link again sets it again. */
export const SHARE_COOKIE_SECONDS = 600;

/** How long the Reports page can show a link just made to the person who made it. */
export const SHARE_FLASH_SECONDS = 120;

export const SHARE_COOKIE = 'cm_share';
export const SHARE_FLASH_COOKIE = 'cm_share_made';

/** On each answer of the link's route: not stored, not indexed, and no Referer sent onward. */
export const SHARE_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
} as const;

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The cookie a shared proof page reads its token from. Its path is that one page's, so it is sent
 * with no other request. SameSite=Lax: the redirect that sets it follows a link opened from a mail
 * or a chat, a cross-site navigation, and Strict would drop it on the next request.
 */
function viewCookie(reportId: string, token: string): string {
  return `${SHARE_COOKIE}=${token}; Path=${shareViewPath(reportId)}; Max-Age=${SHARE_COOKIE_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

function cookieValue(cookieHeader: string | null, name: string): string | null {
  for (const part of (cookieHeader ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}

/** The share token a request's `Cookie` header carries for the page it asks for, or null. */
export function shareTokenIn(cookieHeader: string | null): string | null {
  const token = cookieValue(cookieHeader, SHARE_COOKIE);
  return isShareToken(token) ? token : null;
}

/** A link just made: the report it opens and its token. */
export interface MadeLink {
  reportId: string;
  token: string;
}

/**
 * The cookie that carries a link just made from the share form's answer to the Reports page, which
 * shows it once to the person who made it. It is the page's alone (`Path`), a script cannot read it,
 * and it expires by itself after `SHARE_FLASH_SECONDS`: a page cannot clear a cookie.
 */
function flashCookie({ reportId, token }: MadeLink): string {
  return `${SHARE_FLASH_COOKIE}=${reportId}.${token}; Path=${REPORTS_PAGE}; Max-Age=${SHARE_FLASH_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

/** The link the flash cookie's value names, or null for a value this file did not write. */
export function madeLinkIn(value: string | undefined | null): MadeLink | null {
  const [reportId, token, ...rest] = (value ?? '').split('.');
  return reportId !== undefined && ID.test(reportId) && isShareToken(token) && rest.length === 0
    ? { reportId, token }
    : null;
}

// ─── the store and the bucket ────────────────────────────────────────────────────────────────────

/** What a link opens: the report, and the stored object's name in the reports bucket. */
export interface SharedReport {
  reportId: string;
  accountId: string;
  siteId: string;
  kind: Report['kind'];
  format: Report['format'];
  storagePath: string;
}

export type LinkAnswer =
  | ({ outcome: 'open' } & SharedReport)
  /** The link was made and no longer opens: expired, revoked, or its report or account went. */
  | { outcome: 'gone' }
  | { outcome: 'unknown' };

export type CreateAnswer =
  | { outcome: 'created'; expiresAt: string }
  | { outcome: 'not_found' | 'not_ready' };

export interface ShareStore {
  create(reportId: string, token: string, userId: string, now: Date): Promise<CreateAnswer>;
  /** Counts a view when the link opens. */
  open(token: string, now: Date): Promise<LinkAnswer>;
  /** `open` without the count. */
  read(token: string, now: Date): Promise<LinkAnswer>;
  revoke(reportId: string, now: Date): Promise<void>;
}

export interface ShareFiles {
  /** A URL that reads the stored object for `seconds`. */
  signedUrl(path: string, seconds: number): Promise<string>;
  read(path: string): Promise<Uint8Array>;
}

// ─── making and revoking a link ──────────────────────────────────────────────────────────────────

export interface ShareDeps {
  store: ShareStore;
  capture: AgencyCapture;
  now(): Date;
}

/** The report a route read through the caller's own session. */
export type ReportToShare = Pick<Report, 'id' | 'account_id' | 'kind' | 'format'>;

type Kind = RequestBody['kind'];

/**
 * POST /api/report-files/[id]/share, once the route has established the caller, their seat's reach
 * and role, and the plan. Makes the report's link and answers it once: JSON gets 201
 * `{url, expiresAt}`; a form gets a 303 to the Reports page whose address holds nothing of it, with
 * the link in the flash cookie. 409 `not_ready` for a report whose file is not stored. Nothing here
 * logs the token, and the event names the report's kind and format only.
 */
export async function shareReport(
  deps: ShareDeps,
  caller: { userId: string; origin: string },
  report: ReportToShare,
  kind: Kind,
): Promise<Response> {
  const token = newShareToken();
  const r = await deps.store.create(report.id, token, caller.userId, deps.now());
  if (r.outcome !== 'created') {
    if (r.outcome === 'not_found') return refuse(404, 'not_found');
    return kind === 'form' ? noticeTo(REPORTS_PAGE, 'not_ready') : refuse(409, 'not_ready');
  }
  await deps.capture('report_shared', report.account_id, {
    kind: report.kind,
    format: report.format,
  });
  if (kind === 'json') {
    return Response.json(
      { url: shareUrl(caller.origin, token), expiresAt: r.expiresAt },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const res = noticeTo(REPORTS_PAGE, 'share_made');
  res.headers.append('Set-Cookie', flashCookie({ reportId: report.id, token }));
  return res;
}

/** DELETE /api/report-files/[id]/share: the report's link stops opening. */
export async function revokeShare(
  deps: Pick<ShareDeps, 'store' | 'now'>,
  report: Pick<ReportToShare, 'id'>,
  kind: Kind,
): Promise<Response> {
  await deps.store.revoke(report.id, deps.now());
  return kind === 'form'
    ? noticeTo(REPORTS_PAGE, 'share_revoked')
    : Response.json({ revoked: true });
}

// ─── opening a link ──────────────────────────────────────────────────────────────────────────────

/** A 404 of the link's route, with its headers. */
export const shareNotFound = (): Response => refuse(404, 'not_found', {}, SHARE_HEADERS);

/** A request past the route's bound. */
export const shareTooMany = (retryAfterSeconds: number): Response =>
  refuse(
    429,
    'rate_limited',
    {},
    { ...SHARE_HEADERS, 'Retry-After': String(Math.max(1, retryAfterSeconds)) },
  );

/** What a link that no longer opens answers with. Static: nothing of the request or the link is in it. */
export const GONE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>This link no longer opens</title>
</head>
<body>
<h1>This link no longer opens</h1>
<p>It has expired or was withdrawn by the person who shared it. Ask them for a new link.</p>
<p><a href="/">Crawlmouse</a></p>
</body>
</html>
`;

const gone = (): Response =>
  new Response(GONE_PAGE, {
    status: 410,
    headers: { ...SHARE_HEADERS, 'Content-Type': 'text/html; charset=utf-8' },
  });

export interface OpenDeps {
  store: ShareStore;
  files: ShareFiles;
  capture: AgencyCapture;
  now(): Date;
}

/**
 * GET /s/[token], after the flag and the rate limit. 404 for a value that is not token-shaped (no
 * database read) and for a hash no link holds; 410 for a link that was made and no longer opens. A
 * link that opens is counted (`open_share_link`), then: a proof page is a 303 to its page with the
 * token in that page's cookie; any other format is a 302 to a signed URL of the stored object that
 * lives `SIGNED_URL_SECONDS`.
 */
export async function openShareLink(
  deps: OpenDeps,
  origin: string,
  token: string,
): Promise<Response> {
  if (!isShareToken(token)) return shareNotFound();
  const link = await deps.store.open(token, deps.now());
  if (link.outcome === 'unknown') return shareNotFound();
  if (link.outcome === 'gone') return gone();

  await deps.capture('share_link_opened', link.accountId, {
    kind: link.kind,
    format: link.format,
  });
  if (link.format === 'html') {
    const res = new Response(null, {
      status: 303,
      headers: { ...SHARE_HEADERS, Location: `${origin}${shareViewPath(link.reportId)}` },
    });
    res.headers.append('Set-Cookie', viewCookie(link.reportId, token));
    return res;
  }
  return new Response(null, {
    status: 302,
    headers: {
      ...SHARE_HEADERS,
      Location: await deps.files.signedUrl(link.storagePath, SIGNED_URL_SECONDS),
    },
  });
}

/**
 * What `/s/view/[reportId]` reads: the proof page's stored document, for a token whose link opens
 * that report. Null for no token, a link that does not open, a link of another report, and a report
 * that is not a proof page.
 */
export async function sharedProof(
  deps: Pick<OpenDeps, 'store' | 'files' | 'now'>,
  reportId: string,
  token: string | null,
): Promise<{ report: SharedReport; bytes: Uint8Array } | null> {
  if (token === null) return null;
  const link = await deps.store.read(token, deps.now());
  if (link.outcome !== 'open' || link.reportId !== reportId || link.format !== 'html') return null;
  return { report: link, bytes: await deps.files.read(link.storagePath) };
}
