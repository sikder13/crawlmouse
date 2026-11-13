/**
 * What the CC-26b routes share. Each route still calls `getUser()` and its membership `rpc()`
 * itself, in its own file, ahead of any service-role client: the route registry's mechanism check
 * (`__tests__/security/route-mechanism.ts`) reads those calls from the route's source, so they
 * cannot move in here.
 *
 * Bodies and successful answers are the billing routes' (`lib/billing/request-body.ts`): a form is
 * answered with a 303, JSON with JSON. A refusal is `{ code, …detail }`, the shape of the v2 door's
 * and the public check routes' refusals.
 */
import type { TierGates } from '../../entitlement-v2';
import type { RequestBody } from '../../billing/request-body';

export { readBody, respond, type RequestBody } from '../../billing/request-body';

/** A refusal: the status, a stable `code`, and any detail after it. */
export function refuse(
  status: number,
  code: string,
  detail: Readonly<Record<string, unknown>> = {},
  headers: Readonly<Record<string, string>> = {},
): Response {
  return Response.json({ ...detail, code }, { status, headers });
}

/** A route's answer when its flag is off, and for a row that is not the caller's. */
export const notFound = (): Response => refuse(404, 'not_found');

/** A refusal for a gate the caller's tier does not open, named as `GATES` names it. */
export const paywall = (gate: keyof TierGates): Response =>
  refuse(402, 'upgrade_required', { gate });

/**
 * Why a check cannot start now, the product's one table of 503 codes (owner ruling R28; CC-22b
 * exports the same table and this one is replaced by it at the merge).
 */
export const SERVICE_CODES = {
  /** `CRAWL_PAUSED` is set. */
  paused: 'paused',
  /** `V2_PIPELINE` is off, so a queued check would never run. */
  unavailable: 'unavailable',
  /** The day's `global:audits:day` ceiling refused the start. */
  capacity: 'capacity',
} as const;

export const serviceRefusal = (code: keyof typeof SERVICE_CODES): Response =>
  refuse(503, SERVICE_CODES[code]);

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A path id as the tables key their rows: a lowercase UUID. */
export const isId = (v: string): boolean => ID.test(v);

/**
 * The method a request means: a form posts PATCH and DELETE as POST with `_method`
 * (`view/account-actions.ts`, `action()`), JSON uses the request's own method. The `_method` field
 * is not a field of the action, so it is left out of what is returned.
 */
export function meantMethod(
  req: Request,
  body: RequestBody,
): { method: string; fields: RequestBody['fields'] } {
  if (req.method !== 'POST' || body.kind !== 'form' || !('_method' in body.fields)) {
    return { method: req.method, fields: body.fields };
  }
  const { _method, ...fields } = body.fields;
  return { method: String(_method).toUpperCase(), fields };
}

/**
 * The refusals a live form can be sent back with, each with a line on the page it returns to
 * (`NOTICE_LINES`, lib/v2/copy/notices.ts). A form refused for any other reason is a programming
 * error here rather than a page that shows nothing.
 */
export const NOTICE_CODES = [
  // a check cannot start (the 503 table)
  'paused',
  'unavailable',
  'capacity',
  // re-check
  'capped',
  'check_running',
  'recently_checked',
  'site_paused',
  // add, edit and remove a site
  'adds_capped',
  'domain_capped',
  'site_exists',
  'upgrade_required',
  'invalid_host',
  'host_refused',
  'staging_site',
  'role_refused',
  'scoped_seat',
  'no_account',
  'account_ambiguous',
  'confirm_required',
  // the Pro trial
  'not_owner',
  'not_eligible',
  'refused',
  'conflict',
  'trial_failed',
  'trial_unavailable',
  // mark done: the mark, and what happened to its re-check
  'not_markable',
  'marked_done',
  'marked_done_capped',
  'marked_done_check_running',
  'marked_done_recently_checked',
  'marked_done_capacity',
  'marked_done_site_paused',
  'marked_done_not_checked',
  // email a developer
  'email_requested',
  'invalid_email',
  'rate_limited',
  // seats and invitations (CC-31)
  'seat_invited',
  'seat_resent',
  'invite_not_mailed',
  'seat_changed',
  'seat_removed',
  'seat_exists',
  'seats_full',
  'invalid_scope',
  'seat_owner',
  'not_invited',
  'invite_gone',
  'email_mismatch',
  'invite_full',
  'already_member',
  // buying seats and sites (CC-31)
  'extras_changed',
  'extras_unchanged',
  'in_use',
  'mixed_change',
  'payment_failed',
  'subscription_unchangeable',
  'billing_unavailable',
  // making a report (CC-31)
  'reports_capped',
  'fix_not_verified',
  // share links (CC-31)
  'share_made',
  'share_revoked',
  'not_ready',
  // client report schedules, and the recipient's two links (CC-31)
  'schedule_saved',
  'schedule_cleared',
  'client_saved',
  'invalid_owner',
  'confirmation_requested',
  'nothing_to_confirm',
  'schedule_resumed',
  'not_paused',
  'report_confirmed',
  'report_paused',
  'report_link_gone',
  // any body the route could not read
  'invalid',
  // a form posted without the method it means (`meantMethod`)
  'method_not_allowed',
] as const;

export type NoticeCode = (typeof NOTICE_CODES)[number];

const NOTICE_SET: ReadonlySet<string> = new Set(NOTICE_CODES);

/**
 * The pages a form posts from: the dashboard, Seats, Reports, an invitation's page, a report
 * recipient's two link pages, one site's page, and for an agency the client matrix, its client
 * reports and one client's page.
 */
const BACK =
  /^\/(?:dashboard|seats|reports|invite|s\/confirm|s\/pause|agency|agency\/reports|(?:sites|agency\/clients)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/**
 * The page a form was posted from, when it is one a form can go back to (one of `BACK`'s pages, on
 * this request's own origin, read from `Referer`); otherwise `fallback`. Only the path is kept, so
 * nothing else the header carries reaches the answer.
 */
export function backFrom(req: Request, fallback: string): string {
  const referer = req.headers.get('referer');
  if (!referer) return fallback;
  try {
    const from = new URL(referer);
    return from.origin === new URL(req.url).origin && BACK.test(from.pathname)
      ? from.pathname
      : fallback;
  } catch {
    return fallback;
  }
}

const isFormRequest = (req: Request): boolean =>
  req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ===
  'application/x-www-form-urlencoded';

/** A timestamp as the routes write `nextAllowedAt`: ISO 8601, UTC. */
const isInstant = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v) && !Number.isNaN(Date.parse(v));

/** Whether an answer goes to a form: from its request's content type, or its body's kind. */
const toForm = (from: Request | RequestBody['kind']): boolean =>
  typeof from === 'string' ? from === 'form' : isFormRequest(from);

/**
 * A form's answer: a 303 to `back` with `notice` and, when given, the next-allowed time as `next`.
 * Only the code and that timestamp go into the address.
 */
export function noticeTo(back: string, code: NoticeCode, next?: string | null): Response {
  if (!BACK.test(back)) throw new Error(`refuseTo: not a page to go back to: ${back}`);
  if (!NOTICE_SET.has(code)) throw new Error(`refuseTo: ${code} has no notice`);
  const query = new URLSearchParams({ notice: code });
  if (isInstant(next)) query.set('next', next);
  return new Response(null, { status: 303, headers: { location: `${back}?${query}` } });
}

/**
 * A refusal, answered for what sent it (a request, or the kind of its body). A form is sent back to `back` (303) with the code as
 * `notice` and, when the detail carries one, `nextAllowedAt` as `next`; no other detail and nothing
 * from the request goes into the address. JSON gets `refuse()`'s `{code, …detail}`. A 401 and a 404
 * are `refuse()`'s for a form too, so a stranger's id is not answered with a page.
 */
export function refuseTo(
  from: Request | RequestBody['kind'],
  back: string,
  status: number,
  code: NoticeCode | 'auth_required' | 'not_found',
  detail: Readonly<Record<string, unknown>> = {},
  headers: Readonly<Record<string, string>> = {},
): Response {
  if (status === 401 || status === 404 || !toForm(from))
    return refuse(status, code, detail, headers);
  return noticeTo(
    back,
    code as NoticeCode,
    isInstant(detail.nextAllowedAt) ? detail.nextAllowedAt : null,
  );
}

/** A request over a bound: 429 with when the next is allowed (`Retry-After` too), or its notice. */
export function tooSoonTo(
  from: Request | RequestBody['kind'],
  back: string,
  code: Extract<NoticeCode, 'capped' | 'recently_checked' | 'adds_capped' | 'domain_capped'>,
  nextAllowedAt: string,
  now = Date.now(),
): Response {
  const seconds = Math.max(1, Math.ceil((Date.parse(nextAllowedAt) - now) / 1000));
  return refuseTo(from, back, 429, code, { nextAllowedAt }, { 'retry-after': String(seconds) });
}

/** A page's `notice` and `next` search params, read back: null unless the notice is one of ours. */
export function noticeOf(
  params: Readonly<Record<string, string | string[] | undefined>>,
): { code: NoticeCode; next: string | null } | null {
  const code = params.notice;
  if (typeof code !== 'string' || !NOTICE_SET.has(code)) return null;
  return { code: code as NoticeCode, next: isInstant(params.next) ? params.next : null };
}
