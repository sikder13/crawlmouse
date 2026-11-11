/**
 * The fix routes' logic (CC-26b D5, D9): mark done, the packet, and emailing a fix to a developer.
 * A route runs it once the caller is signed in and their own session has answered
 * `is_member_for_fix` for the fix (the route registry reads those calls from the route file itself).
 *
 * Every handler then reads, in this order: the fix (service role: `site_fixes` has no client grant);
 * its site with the caller's session, so seat scope applies again and a removed site is a 404 (plan
 * revision R19); the entitlement of the site's own account (R3), not of the viewer's default; and
 * the caller's active seat on that account. A fix none of that finds is the same 404 as a fix that
 * does not exist.
 *
 * Which fixes a tier sees. With `GATES[tier].fixesVisible` `'all'`, every fix. On Free, the fixes
 * `isFreeFix` (view/free-fixes.ts) opens at the site's latest finished or partial check, read over
 * the site's checks, fixes and events (R25). A fix marked done stays among them until a check
 * verifies it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Check, Fix, FixtureDataset } from '@crawlmouse/types/v2';
import { z } from 'zod';
import { checkStarted, type Capture } from './events';
import type { FixesStore, SiteFixes } from './fixes-store';
import type { RecheckOutcome, RequestRecheck } from './recheck';
import {
  noticeTo,
  notFound,
  paywall,
  refuse,
  refuseTo,
  type NoticeCode,
  type RequestBody,
} from './route';
import { readEntitlement, type Entitlement } from './viewer-read';
import { packetPrompt } from '../view/segment/fixes';
import { isFreeFix } from '../view/free-fixes';
import type { CheckDataset } from '../pipeline/types';

export interface FixDeps {
  /** The caller's own client. */
  session: SupabaseClient;
  store: FixesStore;
  capture: Capture;
  now(): Date;
}

export interface FixCaller {
  fixId: string;
  userId: string;
}

interface Reached {
  fix: Fix;
  site: { id: string; account_id: string; paused_reason: string | null };
  entitlement: Entitlement;
  seatId: string;
}

const SiteRow = z.object({
  id: z.string(),
  account_id: z.string(),
  removed_at: z.string().nullable(),
  paused_reason: z.string().nullable(),
});

function failed(what: string, error: { message: string }): never {
  throw new Error(`fixes: ${what}: ${error.message}`);
}

/** The fix, its live site, the site's account's entitlement and the caller's seat; null for a 404. */
async function reach(deps: FixDeps, caller: FixCaller): Promise<Reached | null> {
  const fix = await deps.store.fix(caller.fixId);
  if (fix === null) return null;
  const site = await deps.session
    .from('sites')
    .select('id, account_id, removed_at, paused_reason')
    .eq('id', fix.site_id)
    .maybeSingle();
  if (site.error) failed('sites read', site.error);
  if (site.data === null) return null;
  const s = SiteRow.parse(site.data);
  if (s.removed_at !== null) return null;
  const entitlement = await readEntitlement(deps.session, s.account_id, deps.now());
  if (entitlement === null) return null;
  const seat = await deps.session
    .from('seats')
    .select('id')
    .eq('account_id', s.account_id)
    .eq('user_id', caller.userId)
    .eq('status', 'active')
    .maybeSingle();
  if (seat.error) failed('seats read', seat.error);
  if (seat.data === null) return null;
  return { fix, site: s, entitlement, seatId: z.object({ id: z.string() }).parse(seat.data).id };
}

/** The site's latest finished or partial check: the one whose fix list the screens show. */
function latestResult(checks: readonly Check[]): Check | null {
  const done = checks.filter((c) => c.finished_at !== null);
  return done.sort((a, b) => Date.parse(b.finished_at!) - Date.parse(a.finished_at!))[0] ?? null;
}

/** Whether Free opens `fix` at the site's latest result, over the site's own rows. */
export function freeOpens(site: SiteFixes, fix: Pick<Fix, 'id'>, asOf: Date): boolean {
  const check = latestResult(site.checks);
  if (check === null) return false;
  const dataset: CheckDataset = {
    provenance: 'measured',
    as_of: asOf.toISOString(),
    description: `fix visibility at check ${check.id}`,
    engine_derived: [],
    accounts: [],
    seats: [],
    sites: [],
    checks: site.checks,
    page_results: [],
    link_edges: [],
    access_tests: [],
    fixes: site.fixes,
    fix_events: site.events,
    changes: [],
    alert_rules: [],
    reports: [],
    lineages: [],
    usage_events: [],
    withheld: [],
  };
  // isFreeFix reads the dataset's checks, fixes and fix events. Its parameter names the fixture
  // dataset (view/free-fixes.ts), whose provenance a measured dataset does not share.
  return isFreeFix(dataset as unknown as FixtureDataset, check, fix);
}

async function visible(deps: FixDeps, r: Reached): Promise<boolean> {
  if (r.entitlement.gates.fixesVisible === 'all') return true;
  return freeOpens(await deps.store.siteFixes(r.site.id), r.fix, deps.now());
}

// ─── Mark done ──────────────────────────────────────────────────────────────────────────────────

export interface MarkDoneDeps extends FixDeps {
  requestRecheck: RequestRecheck;
}

/**
 * POST /api/fixes/[id]/done once membership is established: 402 `fixesVisible` for a fix the tier
 * does not see; 409 `not_markable` for a verified fix; otherwise the mark (or the mark already
 * there) and a `fix_recheck` of the site, which shares the site's daily re-check cap (Q3). The mark
 * stands whatever the re-check answers (capped, check_running, capacity, paused: a paused site's
 * answer carries its `pausedReason`, read with the caller's session). A form is sent to the site's
 * page, JSON gets `{status: 'marked_done', recheck}`. `fix_marked_done` is sent once, for the call
 * that marked it, and `check_started` when the re-check created a check.
 */
export async function markDone(
  deps: MarkDoneDeps,
  caller: FixCaller,
  kind: RequestBody['kind'],
): Promise<Response> {
  const r = await reach(deps, caller);
  if (r === null) return notFound();
  const back = `/sites/${r.site.id}`;
  if (!(await visible(deps, r)))
    return refuseTo(kind, back, 402, 'upgrade_required', { gate: 'fixesVisible' });
  const marked = await deps.store.markDone(r.fix.id, r.seatId);
  if (marked.outcome === 'not_found' || marked.outcome === 'removed') return notFound();
  if (marked.outcome === 'refused')
    return refuseTo(kind, back, 409, 'not_markable', { status: marked.status });
  if (marked.outcome === 'marked') {
    await deps.capture('fix_marked_done', r.site.account_id, { type: r.fix.type });
  }
  const outcome: RecheckOutcome = await deps.requestRecheck({
    siteId: r.site.id,
    trigger: 'fix_recheck',
    cap: r.entitlement.gates.manualChecksPerSiteDay,
    requestedByUserId: caller.userId,
  });
  if (outcome.queued && outcome.created) {
    await deps.capture(
      'check_started',
      r.site.account_id,
      checkStarted('fix_recheck', outcome.checkId),
    );
  }
  const recheck =
    !outcome.queued && outcome.reason === 'paused'
      ? { ...outcome, pausedReason: r.site.paused_reason }
      : outcome;
  if (kind === 'form') {
    return outcome.queued
      ? noticeTo(back, 'marked_done')
      : noticeTo(
          back,
          UNQUEUED[outcome.reason],
          outcome.reason === 'capped' ? outcome.nextAllowedAt : null,
        );
  }
  return Response.json({ status: 'marked_done', recheck });
}

/** A form's notice when the mark stands and its re-check was not queued, by the reason. */
const UNQUEUED: Record<Extract<RecheckOutcome, { queued: false }>['reason'], NoticeCode> = {
  capped: 'marked_done_capped',
  check_running: 'marked_done_check_running',
  capacity: 'marked_done_capacity',
  paused: 'marked_done_site_paused',
  removed: 'marked_done_not_checked',
};

// ─── The packet ─────────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/fixes/[id]/packet once membership is established: `{packet}` for a fix the tier sees
 * (Free: `GATES.free.packets` is `visible_fixes_only`), 402 `packets` otherwise, 404 `no_packet` for
 * a fix no packet was written for.
 */
export async function packet(deps: FixDeps, caller: FixCaller): Promise<Response> {
  const r = await reach(deps, caller);
  if (r === null) return notFound();
  if (r.entitlement.gates.packets !== 'all' && !(await visible(deps, r))) {
    return paywall('packets');
  }
  if (r.fix.packet === null) return refuse(404, 'no_packet');
  return Response.json({ packet: r.fix.packet, prompt: packetPrompt(r.fix, r.fix.packet) });
}

// ─── Email a developer ──────────────────────────────────────────────────────────────────────────

/** One limit's verdict, as `checkRateLimit` (lib/rate-limit.ts) answers it. */
export interface LimitVerdict {
  allowed: boolean;
  resetAt: Date;
}

/**
 * The fix page's two limits (questions.md Q8), each counting one request when called. The route makes
 * the `checkRateLimit` calls itself, so the window guard (lib/rate-limit-callers.test.ts) reads them.
 */
export interface EmailLimits {
  /** 3 per fix per day, shared by the account's members. */
  perFix(): Promise<LimitVerdict>;
  /** 5 per user per hour. */
  perUser(): Promise<LimitVerdict>;
}

export interface EmailEvent {
  id: string;
  name: 'fix.email_developer_requested';
  data: { requestId: string };
}

export interface EmailDeps extends FixDeps {
  limits: EmailLimits;
  send(event: EmailEvent): Promise<unknown>;
}

const EmailBody = z.strictObject({ email: z.email().max(254) });

/**
 * POST /api/fixes/[id]/email-developer `{email}` once membership is established: 402
 * `fixesVisible` for a fix the tier does not see; 400 `invalid_email`; 429 `rate_limited` with
 * `Retry-After` past either limit, both failing closed, the per-fix one counted first so a request
 * it refuses spends none of the caller's hourly sends; otherwise a `fix_email_requests` row holding
 * the address, then one `fix.email_developer_requested` event naming only that row, with the row's
 * id in the event id, and `{queued: true}`. CC-28's mailer reads the row and sends; nothing is sent
 * from here (owner ruling Q8).
 */
export async function emailDeveloper(
  deps: EmailDeps,
  caller: FixCaller,
  body: RequestBody | null,
): Promise<Response> {
  const r = await reach(deps, caller);
  if (r === null) return notFound();
  const kind = body?.kind ?? 'json';
  if (!(await visible(deps, r)))
    return refuseTo(kind, EMAIL_BACK, 402, 'upgrade_required', { gate: 'fixesVisible' });
  const input = EmailBody.safeParse(body?.fields ?? {});
  if (!input.success) return refuseTo(kind, EMAIL_BACK, 400, 'invalid_email');
  const to = input.data.email.toLowerCase();

  for (const limit of [deps.limits.perFix, deps.limits.perUser]) {
    const verdict = await limit();
    if (!verdict.allowed) {
      const seconds = Math.max(
        1,
        Math.ceil((verdict.resetAt.getTime() - deps.now().getTime()) / 1000),
      );
      // The JSON answer carries the wait as Retry-After only; a form's notice says when.
      return kind === 'form'
        ? noticeTo(EMAIL_BACK, 'rate_limited', verdict.resetAt.toISOString())
        : refuse(429, 'rate_limited', {}, { 'retry-after': String(seconds) });
    }
  }

  const requestId = await deps.store.requestEmail({
    fixId: r.fix.id,
    accountId: r.site.account_id,
    seatId: r.seatId,
    to,
  });
  await deps.send({
    id: `fix-email:${requestId}`,
    name: 'fix.email_developer_requested',
    data: { requestId },
  });
  return kind === 'form'
    ? noticeTo(EMAIL_BACK, 'email_requested')
    : Response.json({ queued: true });
}

/** The page the email action is on (the dashboard's change rows). */
const EMAIL_BACK = '/dashboard';
