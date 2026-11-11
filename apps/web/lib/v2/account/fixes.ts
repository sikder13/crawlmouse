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
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Capture } from './events';
import type { FixesStore, SiteFixes } from './fixes-store';
import type { RecheckOutcome, RequestRecheck } from './recheck';
import { notFound, paywall, refuse, type RequestBody } from './route';
import { readEntitlement, type Entitlement } from './viewer-read';
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
  site: { id: string; account_id: string };
  entitlement: Entitlement;
  seatId: string;
}

const SiteRow = z.object({
  id: z.string(),
  account_id: z.string(),
  removed_at: z.string().nullable(),
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
    .select('id, account_id, removed_at')
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
 * stands whatever the re-check answers. A form is sent to the site's page, JSON gets
 * `{status: 'marked_done', recheck}`. `fix_marked_done` is sent once, for the call that marked it.
 */
export async function markDone(
  deps: MarkDoneDeps,
  caller: FixCaller,
  kind: RequestBody['kind'],
): Promise<Response> {
  const r = await reach(deps, caller);
  if (r === null) return notFound();
  if (!(await visible(deps, r))) return paywall('fixesVisible');
  const marked = await deps.store.markDone(r.fix.id, r.seatId);
  if (marked.outcome === 'not_found' || marked.outcome === 'removed') return notFound();
  if (marked.outcome === 'refused') return refuse(409, 'not_markable', { status: marked.status });
  if (marked.outcome === 'marked') {
    await deps.capture('fix_marked_done', r.site.account_id, { type: r.fix.type });
  }
  const recheck: RecheckOutcome = await deps.requestRecheck({
    siteId: r.site.id,
    trigger: 'fix_recheck',
    cap: r.entitlement.gates.manualChecksPerSiteDay,
    requestedByUserId: caller.userId,
  });
  if (kind === 'form') {
    return new Response(null, { status: 303, headers: { location: `/sites/${r.site.id}` } });
  }
  return Response.json({ status: 'marked_done', recheck });
}

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
  return Response.json({ packet: r.fix.packet });
}

// ─── Email a developer ──────────────────────────────────────────────────────────────────────────

/** The fix page's limits (questions.md Q8): per user per hour, and per fix per day. */
export const EMAIL_LIMITS = {
  perUserHour: { limit: 5, windowMs: 60 * 60 * 1000 },
  perFixDay: { limit: 3, windowMs: 24 * 60 * 60 * 1000 },
} as const;

/** `checkRateLimit`'s shape (lib/rate-limit.ts), passed in so tests need no database. */
export type RateLimit = (
  bucketKey: string,
  limit: number,
  windowMs: number,
  opts: { failClosed: true },
) => Promise<{ allowed: boolean; resetAt: Date }>;

export interface EmailEvent {
  id: string;
  name: 'fix.email_developer_requested';
  data: { fixId: string; siteId: string; accountId: string; requestedBySeatId: string; to: string };
}

export interface EmailDeps extends FixDeps {
  rateLimit: RateLimit;
  send(event: EmailEvent): Promise<unknown>;
}

const EmailBody = z.strictObject({ email: z.email().max(254) });

/**
 * POST /api/fixes/[id]/email-developer `{email}` once membership is established: 402
 * `fixesVisible` for a fix the tier does not see; 400 `invalid_email`; 429 `rate_limited` with
 * `Retry-After` past either limit, both failing closed; otherwise one
 * `fix.email_developer_requested` event, `{queued: true}`. CC-28's mailer sends the email; nothing is
 * sent from here. The event id is the fix, a hash of the address and the day, so a repeat the same
 * day is one event (Inngest drops an id it has seen within 24 hours).
 */
export async function emailDeveloper(
  deps: EmailDeps,
  caller: FixCaller,
  body: RequestBody | null,
): Promise<Response> {
  const r = await reach(deps, caller);
  if (r === null) return notFound();
  if (!(await visible(deps, r))) return paywall('fixesVisible');
  const input = EmailBody.safeParse(body?.fields ?? {});
  if (!input.success) return refuse(400, 'invalid_email');
  const to = input.data.email.toLowerCase();

  for (const [key, { limit, windowMs }] of [
    [`fix-email:user:${caller.userId}`, EMAIL_LIMITS.perUserHour],
    [`fix-email:fix:${r.fix.id}`, EMAIL_LIMITS.perFixDay],
  ] as const) {
    const verdict = await deps.rateLimit(key, limit, windowMs, { failClosed: true });
    if (!verdict.allowed) {
      const seconds = Math.max(
        1,
        Math.ceil((verdict.resetAt.getTime() - deps.now().getTime()) / 1000),
      );
      return Response.json(
        { error: 'rate_limited' },
        { status: 429, headers: { 'retry-after': String(seconds) } },
      );
    }
  }

  const day = deps.now().toISOString().slice(0, 10);
  const address = createHash('sha256').update(to).digest('hex').slice(0, 32);
  await deps.send({
    id: `fix-email:${r.fix.id}:${address}:${day}`,
    name: 'fix.email_developer_requested',
    data: {
      fixId: r.fix.id,
      siteId: r.site.id,
      accountId: r.site.account_id,
      requestedBySeatId: r.seatId,
      to,
    },
  });
  return Response.json({ queued: true });
}
