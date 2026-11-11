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
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { inngest } from '../../../../../inngest/client';
import type { SiteSchedule } from '../../auth/schedule';
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

// ─── re-check ────────────────────────────────────────────────────────────────────────────────────

const CappedAnswer = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('created') }),
  z.strictObject({ outcome: z.literal('exists'), status: z.string() }),
  z.strictObject({ outcome: z.literal('capped'), next_allowed_at: Iso }),
  z.strictObject({ outcome: z.literal('removed') }),
  z.strictObject({ outcome: z.literal('paused'), paused_reason: z.string() }),
]);

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
            { p_row: row, p_cap: req.cap },
            CappedAnswer,
          );
          switch (a.outcome) {
            case 'created':
              return true;
            case 'exists':
              if (a.status === 'queued') return false;
              throw new NotQueued({ queued: false, reason: 'check_running', checkId: row.id });
            case 'capped':
              throw new NotQueued({
                queued: false,
                reason: 'capped',
                nextAllowedAt: a.next_allowed_at,
              });
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
  requestedByUserId: string;
}

export type AddSiteOutcome =
  | { outcome: 'created'; siteId: string; checkId: string; n: number }
  | { outcome: 'exists'; siteId: string }
  | { outcome: 'full' }
  | { outcome: 'adds_capped'; nextAllowedAt: string };

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
          const a = await call(
            admin,
            'add_site',
            { p_site: row, p_check: check, p_limit: site.limit },
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
