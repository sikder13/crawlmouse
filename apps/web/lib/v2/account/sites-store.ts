/**
 * The site routes' writes (CC-26b D4, D6), over migration 20261112000001's section A with the
 * service-role client. A route calls these only after it has checked the caller's membership and
 * role through the caller's own session, and read the entitlement of the site's own account.
 *
 * A re-check and a first audit go through the pipeline's `requestCheck`, so the `checks` row and the
 * `check.requested` event are the ones it writes for every other trigger; only the insert differs.
 * Each store's `insertQueued` calls the capped SQL function, and a refusal is thrown before
 * `requestCheck` reaches its send, so a refused request sends nothing.
 */
import { randomUUID } from 'node:crypto';
import { AlertRuleKindSchema, ChannelSchema, type AlertRuleKind } from '@crawlmouse/types/v2';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { inngest } from '../../../../../inngest/client';
import type { SiteSchedule } from '../../auth/schedule';
import type { RequestBody } from '../../billing/request-body';
import type { TierGates } from '../../entitlement-v2';
import { normalizeDomain } from '../../domain';
import { DOMAIN_AUDITS_PER_HOUR, GLOBAL_AUDITS_BUCKET, GLOBAL_AUDITS_PER_DAY } from '../../limits';
import { MAX_RATE_LIMIT_WINDOW_MS, rateLimitWindowStart } from '../../rate-limit-window';
import { MANUAL_BUCKET_S } from '../pipeline/limits';
import { requestCheck, type RequestDeps } from '../pipeline/request';
import { supabasePipelineStore, type QueuedCheck } from '../pipeline/store';
import type { RecheckOutcome, RequestRecheck } from './recheck';

type Send = RequestDeps['send'];

const sendWithInngest: Send = (event) => inngest.send(event);

async function call<T>(admin: SupabaseClient, fn: string, args: object, schema: z.ZodType<T>) {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return schema.parse(data);
}

const Iso = z.iso.datetime();

const HOUR_MS = 60 * 60 * 1000;

/**
 * A `rate_limits` slot as migration 20261112000001's take_rate_slot takes it: the bucket, the window
 * start `checkRateLimit` would compute for it now, and its limit, so the SQL and `checkRateLimit`
 * count into the same row.
 */
interface Slot {
  bucket: string;
  window_start: string;
  limit: number;
}

const slotOf = (bucket: string, limit: number, windowMs: number, nowMs: number): Slot => ({
  bucket,
  window_start: rateLimitWindowStart(nowMs, windowMs).toISOString(),
  limit,
});

/** The platform's daily ceiling on check starts (`global:audits:day`), shared with v1's audits. */
export const globalSlot = (nowMs: number): Slot =>
  slotOf(GLOBAL_AUDITS_BUCKET, GLOBAL_AUDITS_PER_DAY, MAX_RATE_LIMIT_WINDOW_MS, nowMs);

/** v1's per-domain hourly bucket (app/api/audits/start/route.ts), for a site's first audit. */
export const domainSlot = (host: string, nowMs: number): Slot =>
  slotOf(`domain:${normalizeDomain(host)}`, DOMAIN_AUDITS_PER_HOUR, HOUR_MS, nowMs);

// ─── re-check ────────────────────────────────────────────────────────────────────────────────────

const CappedAnswer = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('created') }),
  z.strictObject({ outcome: z.literal('exists'), status: z.string() }),
  z.strictObject({ outcome: z.literal('capped'), next_allowed_at: Iso }),
  z.strictObject({ outcome: z.literal('capacity') }),
  z.strictObject({ outcome: z.literal('removed') }),
  z.strictObject({ outcome: z.literal('paused'), paused_reason: z.string() }),
]);

/** When the 2-minute bucket that `atMs` falls in ends (`bucketedKey`'s manual and re-check bucket). */
const bucketEnd = (atMs: number): string => {
  const ms = MANUAL_BUCKET_S * 1000;
  return new Date((Math.floor(atMs / ms) + 1) * ms).toISOString();
};

/** A request the database did not record; thrown out of `insertQueued`, so nothing is sent. */
class NotQueued extends Error {
  constructor(readonly outcome: RecheckOutcome & { queued: false }) {
    super(`re-check not queued: ${outcome.reason}`);
  }
}

/**
 * The re-check a member asks for (`RequestRecheck`, lib/v2/account/recheck.ts): `requestCheck` with
 * `request_capped_check` as its insert. Its bucketed check id makes a repeat inside the 2-minute
 * bucket find the row it wrote: while that check is queued the event is sent again with the same id
 * (Inngest drops the duplicate, and a send that failed the first time gets its retry); once it has
 * started the request is answered `check_running` and nothing is sent.
 */
export function supabaseRequestRecheck(
  admin: SupabaseClient,
  send: Send = sendWithInngest,
): RequestRecheck {
  const pipeline = supabasePipelineStore(admin);
  return async (req) => {
    const deps: RequestDeps = {
      store: {
        requestSite: (siteId) => pipeline.requestSite(siteId),
        insertQueued: async (row: QueuedCheck) => {
          const a = await call(
            admin,
            'request_capped_check',
            { p_row: row, p_cap: req.cap, p_global: globalSlot(Date.now()) },
            CappedAnswer,
          );
          switch (a.outcome) {
            case 'created':
              return true;
            case 'exists':
              if (a.status === 'queued') return false;
              if (a.status === 'running') {
                throw new NotQueued({ queued: false, reason: 'check_running', checkId: row.id });
              }
              throw new NotQueued({
                queued: false,
                reason: 'recently_checked',
                nextAllowedAt: bucketEnd(Date.parse(row.queued_at)),
              });
            case 'capped':
              throw new NotQueued({
                queued: false,
                reason: 'capped',
                nextAllowedAt: a.next_allowed_at,
              });
            case 'capacity':
            case 'removed':
            case 'paused':
              throw new NotQueued({ queued: false, reason: a.outcome });
          }
        },
      },
      send,
      now: () => Date.now(),
      newId: randomUUID,
    };
    try {
      const r = await requestCheck(deps, {
        siteId: req.siteId,
        trigger: req.trigger,
        requestedByUserId: req.requestedByUserId,
      });
      return { queued: true, checkId: r.checkId, created: r.created };
    } catch (e) {
      if (e instanceof NotQueued) return e.outcome;
      throw e;
    }
  };
}

// ─── add a site ──────────────────────────────────────────────────────────────────────────────────

export interface NewSite {
  accountId: string;
  /** The seat that adds it: the caller's seat on the account. */
  ownerSeatId: string;
  /** Canonical and admitted (lib/v2/account/sites.ts). */
  host: string;
  schedule: SiteSchedule | null;
  /** The account's site limit now (`limits.sites`), which also bounds first audits a day. */
  limit: number;
  /** Counts the first audit in v1's per-domain hourly bucket; v1 leaves paid tiers out of it. */
  perDomain: boolean;
  requestedByUserId: string;
}

export type AddSiteOutcome =
  | { outcome: 'created'; siteId: string; checkId: string; n: number }
  | { outcome: 'exists'; siteId: string }
  | { outcome: 'full' }
  | { outcome: 'adds_capped'; nextAllowedAt: string }
  | { outcome: 'domain_capped'; nextAllowedAt: string }
  | { outcome: 'capacity' };

const AddAnswer = z.discriminatedUnion('outcome', [
  z.strictObject({
    outcome: z.literal('created'),
    site_id: z.string(),
    check_id: z.string(),
    n: z.int(),
  }),
  z.strictObject({ outcome: z.literal('exists'), site_id: z.string() }),
  z.strictObject({ outcome: z.literal('full') }),
  z.strictObject({ outcome: z.literal('adds_capped'), next_allowed_at: Iso }),
  z.strictObject({ outcome: z.enum(['domain_capped', 'capacity']) }),
]);

class NotAdded extends Error {
  constructor(readonly outcome: Exclude<AddSiteOutcome, { outcome: 'created' }>) {
    super(`site not added: ${outcome.outcome}`);
  }
}

/**
 * Adds a primary site and requests its first audit: `requestCheck` with trigger `first_audit` and
 * an insert that is `add_site`, which writes the site and the check in one transaction. The site does
 * not exist until that insert, so `requestSite` answers with the row being added (its schedule is
 * not read by `requestCheck`, and `next_check_at` stays null for CC-28's scheduler). A send that fails
 * after the insert leaves the site with a queued check that the reaper fails, and a re-check can
 * follow.
 */
export function supabaseAddSite(
  admin: SupabaseClient,
  send: Send = sendWithInngest,
): (site: NewSite) => Promise<AddSiteOutcome> {
  return async (site) => {
    const siteId = randomUUID();
    const row = {
      id: siteId,
      account_id: site.accountId,
      host: site.host,
      owner_seat_id: site.ownerSeatId,
      schedule_cadence: site.schedule?.cadence ?? null,
      schedule_iso_weekday: site.schedule?.iso_weekday ?? null,
      schedule_hour_local: site.schedule?.hour_local ?? null,
    };
    let n = 0;
    const deps: RequestDeps = {
      store: {
        requestSite: async () => ({
          id: siteId,
          account_id: site.accountId,
          host: site.host,
          next_check_at: null,
        }),
        insertQueued: async (check) => {
          const nowMs = Date.now();
          const domain = site.perDomain ? domainSlot(site.host, nowMs) : null;
          const a = await call(
            admin,
            'add_site',
            {
              p_site: row,
              p_check: check,
              p_limit: site.limit,
              p_global: globalSlot(nowMs),
              p_domain: domain,
            },
            AddAnswer,
          );
          switch (a.outcome) {
            case 'created':
              n = a.n;
              return true;
            case 'exists':
              throw new NotAdded({ outcome: 'exists', siteId: a.site_id });
            case 'full':
              throw new NotAdded({ outcome: 'full' });
            case 'adds_capped':
              throw new NotAdded({ outcome: 'adds_capped', nextAllowedAt: a.next_allowed_at });
            case 'domain_capped':
              throw new NotAdded({
                outcome: 'domain_capped',
                nextAllowedAt: new Date(Date.parse(domain!.window_start) + HOUR_MS).toISOString(),
              });
            case 'capacity':
              throw new NotAdded({ outcome: 'capacity' });
          }
        },
      },
      send,
      now: () => Date.now(),
      newId: randomUUID,
    };
    try {
      const r = await requestCheck(deps, {
        siteId,
        trigger: 'first_audit',
        requestedByUserId: site.requestedByUserId,
      });
      return { outcome: 'created', siteId, checkId: r.checkId, n };
    } catch (e) {
      if (e instanceof NotAdded) return e.outcome;
      throw e;
    }
  };
}

// ─── edit and remove ─────────────────────────────────────────────────────────────────────────────

/** What `edit_site` sets; a key left out is left as it is. */
export interface SitePatch {
  schedule?: { cadence: 'weekly' | 'monthly'; iso_weekday: number; hour_local: number } | null;
  competitor_hosts?: string[];
  staging_host?: string | null;
}

export type EditSiteOutcome =
  | { outcome: 'updated'; stagingSiteId: string | null }
  | { outcome: 'removed' | 'is_staging' | 'exists' };

const EditAnswer = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('updated'), staging_site_id: z.string().nullable() }),
  z.strictObject({ outcome: z.enum(['removed', 'is_staging', 'exists']) }),
]);

export async function editSite(
  admin: SupabaseClient,
  siteId: string,
  patch: SitePatch,
): Promise<EditSiteOutcome> {
  const a = await call(admin, 'edit_site', { p_site: siteId, p_patch: patch }, EditAnswer);
  return a.outcome === 'updated'
    ? { outcome: 'updated', stagingSiteId: a.staging_site_id }
    : { outcome: a.outcome };
}

export type RemoveSiteOutcome =
  | { outcome: 'removed'; sites: number }
  | { outcome: 'already_removed' };

const RemoveAnswer = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('removed'), sites: z.int() }),
  z.strictObject({ outcome: z.literal('already_removed') }),
]);

export async function removeSite(
  admin: SupabaseClient,
  siteId: string,
): Promise<RemoveSiteOutcome> {
  return call(admin, 'remove_site', { p_site: siteId }, RemoveAnswer);
}

// ── A site's alert rules (CC-28 D8, `PUT /api/sites/[id]/alert-rules`) ──────────────────────────────

type Channel = z.infer<typeof ChannelSchema>;

/**
 * What a site's rule switch asks for: the kind it overrides, and its switch, its channels or both.
 * A form carries the switch as `true`/`false` and the channels comma-separated (`email,slack`).
 */
export interface SiteRulePlan {
  kind: AlertRuleKind;
  enabled?: boolean;
  channels?: Channel[];
}

export type SiteRuleDecision =
  | { ok: true; plan: SiteRulePlan }
  | { ok: false; status: 400; code: 'invalid' }
  | { ok: false; status: 402; code: 'upgrade_required'; gate: 'slack' };

const Channels = z
  .array(ChannelSchema)
  .min(1)
  .refine((c) => new Set(c).size === c.length);

const siteRuleBody = (kind: RequestBody['kind']) =>
  z
    .strictObject({
      rule: AlertRuleKindSchema,
      enabled: (kind === 'json'
        ? z.boolean()
        : z.enum(['true', 'false']).transform((v) => v === 'true')
      ).optional(),
      channels: (kind === 'json'
        ? Channels
        : z
            .string()
            .max(20)
            .transform((v) => v.split(','))
            .pipe(Channels)
      ).optional(),
    })
    .refine((b) => b.enabled !== undefined || b.channels !== undefined);

/** What the body asks for, under the gates of the site's account's tier now. */
export function decideSiteAlertRule(
  body: RequestBody,
  gates: Readonly<TierGates>,
): SiteRuleDecision {
  const parsed = siteRuleBody(body.kind).safeParse(body.fields);
  if (!parsed.success) return { ok: false, status: 400, code: 'invalid' };
  const { rule, enabled, channels } = parsed.data;
  if (channels?.includes('slack') && !gates.slack) {
    return { ok: false, status: 402, code: 'upgrade_required', gate: 'slack' };
  }
  return {
    ok: true,
    plan: {
      kind: rule,
      ...(enabled === undefined ? {} : { enabled }),
      ...(channels === undefined ? {} : { channels }),
    },
  };
}

export interface SiteRuleState {
  kind: AlertRuleKind;
  enabled: boolean;
  channels: Channel[];
}

export type SiteRuleOutcome =
  | { ok: true; rule: SiteRuleState }
  | { ok: false; status: 404; code: 'not_found' };

const RuleRow = z.object({
  id: z.string(),
  enabled: z.boolean(),
  threshold_points: z.number().nullable(),
  channels: z.array(ChannelSchema),
});

/**
 * Writes `siteId`'s override of the rule `plan.kind` (a per-site row of `alert_rules`, which the
 * alerts read in place of the account's rule of that kind). The first override of a kind starts from
 * the account's rule of that kind, its threshold and channels, with Slack left out on a tier without
 * it (the table's trigger refuses a new row that adds Slack on Free); an account with no rule of that
 * kind has nothing to override, a 404. Every read and write names the account and the site, so
 * another account's rows are never reached.
 */
export async function setSiteAlertRule(
  admin: SupabaseClient,
  accountId: string,
  siteId: string,
  plan: SiteRulePlan,
  gates: Readonly<TierGates>,
): Promise<SiteRuleOutcome> {
  const COLUMNS = 'id, enabled, threshold_points, channels';
  const read = async (site: string | null) => {
    const q = admin
      .from('alert_rules')
      .select(COLUMNS)
      .eq('account_id', accountId)
      .eq('kind', plan.kind);
    const { data, error } = await (
      site === null ? q.is('site_id', null) : q.eq('site_id', site)
    ).maybeSingle();
    if (error) throw new Error(`alert_rules read failed: ${error.message}`);
    return data === null ? null : RuleRow.parse(data);
  };
  const own = await read(siteId);
  if (own !== null) {
    const { error } = await admin
      .from('alert_rules')
      .update({
        ...(plan.enabled === undefined ? {} : { enabled: plan.enabled }),
        ...(plan.channels === undefined ? {} : { channels: plan.channels }),
      })
      .eq('id', own.id)
      .eq('account_id', accountId)
      .eq('site_id', siteId);
    if (error) throw new Error(`alert_rules update failed: ${error.message}`);
  } else {
    const base = await read(null);
    if (base === null) return { ok: false, status: 404, code: 'not_found' };
    const allowed = base.channels.filter((c) => c !== 'slack' || gates.slack);
    const { error } = await admin.from('alert_rules').insert({
      account_id: accountId,
      site_id: siteId,
      kind: plan.kind,
      enabled: plan.enabled ?? base.enabled,
      threshold_points: base.threshold_points,
      channels: plan.channels ?? (allowed.length > 0 ? allowed : ['email']),
    });
    // Another request made the override first (alert_rules_scope_kind_uq): write to that one.
    if (error?.code === '23505') return setSiteAlertRule(admin, accountId, siteId, plan, gates);
    if (error) throw new Error(`alert_rules insert failed: ${error.message}`);
  }
  const written = await read(siteId);
  if (written === null) throw new Error('alert_rules: the override just written is not there');
  return {
    ok: true,
    rule: { kind: plan.kind, enabled: written.enabled, channels: written.channels },
  };
}
