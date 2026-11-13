/**
 * The seat routes' logic (CC-31 D3; docs/specs/v2/31-agency.md §6): invite, change, remove, resend,
 * and accept an invitation. A route runs one of these once the caller is signed in and, for the first
 * four, once their own session has answered `seat_may` for the account they act in (the route
 * registry reads those calls from the route file itself). The rules themselves are SQL's (migration
 * 20261114000002, section A); this file reads the body, asks the store, and answers.
 *
 * A form is answered with a 303 back to its page and a notice (`NOTICE_LINES`), JSON with JSON. A
 * seat of another account, and an account marked for deletion, are the same 404 as no seat.
 */
import { z } from 'zod';
import { GATES, type Tier } from '../../entitlement-v2';
import { clearLinkCookie, LINK_FLOWS } from '../account/link-cookie';
import {
  noticeTo,
  notFound,
  refuse,
  refuseTo,
  type NoticeCode,
  type RequestBody,
} from '../account/route';
import { accountCookie } from '../account/viewer-cookie';
import type { AgencyCapture } from './events';
import type { SeatsStore } from './seats-store';

export const INVITED_ROLES = ['account_manager', 'developer'] as const;
/** The roles a seat is invited as or changed to: an owner is neither. */
export type InvitedRole = (typeof INVITED_ROLES)[number];

/**
 * How long an invitation's link works, in days: `issue_seat_invite`'s interval (migration
 * 20261114000002). The invitation's mail states it, and its test reads the interval from the SQL.
 */
export const INVITE_LINK_DAYS = 7;

/** The page the seat forms are on. */
export const SEATS_PAGE = '/seats';

/**
 * Invitation mail an account may ask for in a day (an invitation and a resend count alike). An
 * invitation names the account, a string its owner chose, to an address the owner chose, so an
 * account in a trial, which has paid nothing yet, is held to a few.
 */
export const INVITE_MAIL_PER_DAY = { trial: 3, paid: 20 } as const;

const TRIAL_STATES: ReadonlySet<string> = new Set(['pro_trial', 'agency_trial']);

/** The day's bound for an account in `state` (`accounts.state`). */
export const inviteMailPerDay = (state: string): number =>
  TRIAL_STATES.has(state) ? INVITE_MAIL_PER_DAY.trial : INVITE_MAIL_PER_DAY.paid;
/** The page an invitation's link lands on (`LINK_FLOWS.invite.page`). */
const INVITE_PAGE = LINK_FLOWS.invite.page;

// ─── bodies ──────────────────────────────────────────────────────────────────────────────────────

const Id = z.uuid();
/** The most client sites a plan holds with its extras, so no scope names more. */
const MAX_SCOPE = GATES.agency.maxSites;

const SeatBody = z.strictObject({
  role: z.enum(INVITED_ROLES),
  scope: z.union([z.literal('all'), z.array(Id).min(1).max(MAX_SCOPE)]),
});

const InviteBody = SeatBody.extend({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
});

const SITE_FIELD = /^site_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/**
 * A form's scope as JSON sends it. The page's form posts `scope=all` or `scope=some` and one
 * `site_<id>` field for each client ticked (a form cannot post one name twice: `readBody` refuses
 * it). With `some`, the scope is the ids ticked; with `all`, ticked boxes are read and dropped,
 * since a form without script cannot untick them. A `site_<id>` field beside any other scope is not
 * a body this reads.
 */
function scopeAsJson(fields: Readonly<Record<string, unknown>>): Record<string, unknown> | null {
  const rest: Record<string, unknown> = {};
  const ticked: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    const site = SITE_FIELD.exec(key);
    if (site) ticked.push(site[1]!);
    else rest[key] = value;
  }
  if (rest.scope === 'some') return { ...rest, scope: ticked };
  if (ticked.length > 0 && rest.scope !== 'all') return null;
  return rest;
}

export interface SeatInput {
  role: InvitedRole;
  /** Every client, or the ids of the client sites the seat covers. */
  scope: 'all' | string[];
}

export interface InviteInput extends SeatInput {
  /** Trimmed and in lower case. */
  email: string;
}

/** POST /api/seats: `{email, role, scope}` and nothing else. */
export function parseInviteBody(fields: Readonly<Record<string, unknown>>): InviteInput | null {
  const r = InviteBody.safeParse(scopeAsJson(fields));
  return r.success ? r.data : null;
}

/** PATCH /api/seats/id/[id]: `{role, scope}` and nothing else. */
export function parseChangeBody(fields: Readonly<Record<string, unknown>>): SeatInput | null {
  const r = SeatBody.safeParse(scopeAsJson(fields));
  return r.success ? r.data : null;
}

const siteIds = (scope: SeatInput['scope']): string[] | null => (scope === 'all' ? null : scope);

// ─── the invitation mail ─────────────────────────────────────────────────────────────────────────

/** One invitation: a seat and the number of the invitation sent for it (`seats.invite_seq`). */
export interface Invitation {
  seatId: string;
  seq: number;
}

/** What asks for an invitation's mail. `seats-store.ts` sends it as an Inngest event. */
export interface InviteMail {
  request(invitation: Invitation): Promise<void>;
}

export interface InviteMailEvent {
  id: string;
  name: 'seat.invite.requested';
  data: { seat_id: string; seq: number };
}

/**
 * The event that asks for an invitation's mail. It names the seat and the invitation's number and
 * holds no address and no token: the handler reads the address from the seat and mints the token
 * through `issue_seat_invite` (lib/v2/mail/handlers.ts). The event's id is the invitation's, so the
 * same invitation asked for twice is one event to Inngest, and a resend, which is the next number,
 * is another.
 */
export function inviteMailEvent({ seatId, seq }: Invitation): InviteMailEvent {
  return {
    id: `seat_invite:${seatId}:${seq}`,
    name: 'seat.invite.requested',
    data: { seat_id: seatId, seq },
  };
}

// ─── the routes ──────────────────────────────────────────────────────────────────────────────────

export interface LimitVerdict {
  allowed: boolean;
  resetAt: Date;
}

/** The bounds on invitation mail, shared by an invite and a resend. */
export interface InviteLimits {
  perAccount(): Promise<LimitVerdict>;
  perIp(): Promise<LimitVerdict>;
}

export interface SeatDeps {
  store: SeatsStore;
  capture: AgencyCapture;
  mail: InviteMail;
  limits: InviteLimits;
  now(): Date;
}

/** The account the caller acts in, from their viewer. */
export interface SeatAccount {
  accountId: string;
  tier: Tier;
  /** The seat limit at this moment, with the trial and past-due clocks read (`limits.seats`). */
  seatLimit: number;
  /** Whether the plan sells seats beyond its own (`gates.agencyBranding`: Agency alone). */
  canBuySeats: boolean;
}

type Kind = RequestBody['kind'];

const done = (kind: Kind, notice: NoticeCode, json: Record<string, unknown>, status = 200) =>
  kind === 'form' ? noticeTo(SEATS_PAGE, notice) : Response.json(json, { status });

/** No seat free: 402 with the gate's name and whether a seat can be bought; a form gets its notice. */
const full = (kind: Kind, account: SeatAccount) =>
  kind === 'form'
    ? noticeTo(SEATS_PAGE, account.tier === 'free' ? 'upgrade_required' : 'seats_full')
    : refuse(402, 'upgrade_required', { gate: 'seats', canBuySeats: account.canBuySeats });

async function overLimit(
  deps: Pick<SeatDeps, 'limits' | 'now'>,
  kind: Kind,
): Promise<Response | null> {
  for (const limit of [deps.limits.perAccount, deps.limits.perIp]) {
    const verdict = await limit();
    if (verdict.allowed) continue;
    const seconds = Math.max(
      1,
      Math.ceil((verdict.resetAt.getTime() - deps.now().getTime()) / 1000),
    );
    return kind === 'form'
      ? noticeTo(SEATS_PAGE, 'rate_limited', verdict.resetAt.toISOString())
      : refuse(429, 'rate_limited', {}, { 'retry-after': String(seconds) });
  }
  return null;
}

/**
 * Asks for the invitation's mail. The seat's row is written by then (and, for a resend, the link
 * sent before no longer works), so a request that cannot be queued is not thrown: the caller is
 * told, and "Send a new invitation" on the seat's row asks again.
 */
async function mailAsked(deps: Pick<SeatDeps, 'mail'>, seatId: string, seq: number) {
  try {
    await deps.mail.request({ seatId, seq });
    return true;
  } catch {
    return false;
  }
}

/** 503 `invite_not_mailed` with the seat's id; a form is sent back to Seats with the notice. */
const notMailed = (kind: Kind, seatId: string): Response =>
  refuseTo(kind, SEATS_PAGE, 503, 'invite_not_mailed', { seatId });

/**
 * POST /api/seats. 400 `invalid` for a body that is not `{email, role, scope}`; 402 `upgrade_required`
 * with gate `seats` on Free, before anything is counted or written; 429 `rate_limited` past either
 * bound on invitation mail; then `invite_seat`: 201 with the seat's id, 400 `invalid_scope`, 409
 * `seat_exists`, 402 when no seat is free. An invitation written is followed by the `seat_invited`
 * event and the request for its mail.
 */
export async function inviteSeat(
  deps: SeatDeps,
  account: SeatAccount,
  body: RequestBody | null,
): Promise<Response> {
  const kind = body?.kind ?? 'json';
  const input = body && parseInviteBody(body.fields);
  if (!input) return refuseTo(kind, SEATS_PAGE, 400, 'invalid');
  if (account.tier === 'free') return full(kind, account);
  const limited = await overLimit(deps, kind);
  if (limited) return limited;

  const r = await deps.store.invite({
    accountId: account.accountId,
    email: input.email,
    role: input.role,
    siteIds: siteIds(input.scope),
    cap: account.seatLimit,
    now: deps.now(),
  });
  switch (r.outcome) {
    case 'invited':
      await deps.capture('seat_invited', account.accountId, {
        role: input.role,
        scoped: input.scope !== 'all',
      });
      if (!(await mailAsked(deps, r.seatId, r.seq))) return notMailed(kind, r.seatId);
      return done(kind, 'seat_invited', { seatId: r.seatId }, 201);
    case 'marked':
      return notFound();
    case 'invalid_scope':
      return refuseTo(kind, SEATS_PAGE, 400, 'invalid_scope');
    case 'exists':
      return refuseTo(kind, SEATS_PAGE, 409, 'seat_exists');
    case 'full':
      return full(kind, account);
  }
}

/** PATCH /api/seats/id/[id] `{role, scope}`: 409 `seat_owner` for the owner's seat. */
export async function changeSeat(
  deps: Pick<SeatDeps, 'store'>,
  accountId: string,
  seatId: string,
  kind: Kind,
  fields: Readonly<Record<string, unknown>>,
): Promise<Response> {
  const input = parseChangeBody(fields);
  if (!input) return refuseTo(kind, SEATS_PAGE, 400, 'invalid');
  const r = await deps.store.change(seatId, accountId, input.role, siteIds(input.scope));
  switch (r.outcome) {
    case 'changed':
      return done(kind, 'seat_changed', { changed: true });
    case 'marked':
    case 'not_found':
      return notFound();
    case 'owner':
      return refuseTo(kind, SEATS_PAGE, 409, 'seat_owner');
    case 'invalid_scope':
      return refuseTo(kind, SEATS_PAGE, 400, 'invalid_scope');
  }
}

/** DELETE /api/seats/id/[id]: 409 `seat_owner` for the owner's seat. */
export async function removeSeat(
  deps: Pick<SeatDeps, 'store' | 'now'>,
  accountId: string,
  seatId: string,
  kind: Kind,
): Promise<Response> {
  const r = await deps.store.remove(seatId, accountId, deps.now());
  switch (r.outcome) {
    case 'removed':
      return done(kind, 'seat_removed', { removed: true });
    case 'marked':
    case 'not_found':
      return notFound();
    case 'owner':
      return refuseTo(kind, SEATS_PAGE, 409, 'seat_owner');
  }
}

/**
 * POST /api/seats/id/[id]/resend: the seat's next invitation, under the bounds an invite is under.
 * 409 `not_invited` for a seat already accepted.
 */
export async function resendInvite(
  deps: Pick<SeatDeps, 'store' | 'mail' | 'limits' | 'now'>,
  accountId: string,
  seatId: string,
  kind: Kind,
): Promise<Response> {
  const limited = await overLimit(deps, kind);
  if (limited) return limited;
  const r = await deps.store.resend(seatId, accountId);
  switch (r.outcome) {
    case 'resent':
      if (!(await mailAsked(deps, seatId, r.seq))) return notMailed(kind, seatId);
      return done(kind, 'seat_resent', { resent: true });
    case 'marked':
    case 'not_found':
      return notFound();
    case 'not_invited':
      return refuseTo(kind, SEATS_PAGE, 409, 'not_invited');
  }
}

// ─── accepting ───────────────────────────────────────────────────────────────────────────────────

/** The accept form posts no field: the token is the cookie's. */
const AcceptBody = z.strictObject({});

export interface AcceptCaller {
  userId: string;
  /** The invitation's token from the `cm_link_invite` cookie, or null. */
  token: string | null;
  /** Whether the switcher's cookie is set `Secure`: true wherever the site is HTTPS. */
  secure: boolean;
}

function setCookie(c: ReturnType<typeof accountCookie>): string {
  return `${c.name}=${c.value}; Path=${c.path}; Max-Age=${c.maxAge}; HttpOnly; SameSite=Lax${c.secure ? '; Secure' : ''}`;
}

const inviteRefusal = (kind: Kind, status: number, code: NoticeCode, spent: boolean): Response => {
  const res = kind === 'form' ? noticeTo(INVITE_PAGE, code) : refuse(status, code);
  if (spent) res.headers.append('Set-Cookie', clearLinkCookie('invite'));
  return res;
};

/**
 * POST /api/seats/accept, for a signed-in caller. The token is read from the invitation's cookie and
 * from nowhere else. Accepted: the switcher's cookie is set to the joined account, the invitation's
 * cookie is cleared, and the caller goes to the dashboard (a form) or is told the account (JSON).
 * 410 `invite_no_link` for no token in the cookie, where no invitation was read; 410 `invite_gone`
 * for a link that cannot be used (its cookie is cleared) and for an account marked for deletion (the
 * cookie is kept); 403 `email_mismatch` when the caller's address is not the invited one, with the
 * cookie kept so the invited person can still accept; 409 `invite_full` and `already_member`.
 */
export async function acceptInvite(
  deps: Pick<SeatDeps, 'store' | 'capture' | 'now'>,
  caller: AcceptCaller,
  body: RequestBody | null,
): Promise<Response> {
  if (!body || !AcceptBody.safeParse(body.fields).success) return refuse(400, 'invalid');
  const kind = body.kind;
  if (caller.token === null) return inviteRefusal(kind, 410, 'invite_no_link', false);

  const r = await deps.store.accept(caller.token, caller.userId, deps.now());
  switch (r.outcome) {
    case 'accepted': {
      await deps.capture('seat_accepted', r.accountId, { role: r.role });
      const res =
        kind === 'form'
          ? new Response(null, { status: 303, headers: { location: '/dashboard' } })
          : Response.json({ accountId: r.accountId });
      res.headers.append('Set-Cookie', setCookie(accountCookie(r.accountId, caller.secure)));
      res.headers.append('Set-Cookie', clearLinkCookie('invite'));
      return res;
    }
    case 'gone':
      return inviteRefusal(kind, 410, 'invite_gone', true);
    // The account may be restored inside its window, so the link is not spent.
    case 'marked':
      return inviteRefusal(kind, 410, 'invite_gone', false);
    case 'email_mismatch':
      return inviteRefusal(kind, 403, 'email_mismatch', false);
    case 'full':
      return inviteRefusal(kind, 409, 'invite_full', false);
    case 'already_member':
      return inviteRefusal(kind, 409, 'already_member', false);
  }
}
