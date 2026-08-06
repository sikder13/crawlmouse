import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { ACTIVE_STATUSES, subscriptionPeriodEnd } from '@crawlmouse/types';

export interface ReconcileCustomer {
  id: string;
  stripe_customer_id: string | null;
}

/**
 * Derive the `pro_until` a customer's subscriptions imply. The discriminated result makes the
 * "leave them alone" case unrepresentable as a value:
 * - `{ skip: true }` — the customer has an active sub but NO resolvable period-end, so we can't
 *   compute a value and must NOT downgrade an existing subscriber.
 * - `{ skip: false, proUntil }` — `proUntil` is the latest period-end across active subs, or null
 *   when none are active (→ clear Pro).
 */
export type DerivedProUntil = { skip: true } | { skip: false; proUntil: string | null };

/**
 * Compare two `pro_until` values by INSTANT rather than by raw string. The stored value comes back
 * from Supabase as `...+00:00`, while the value we derive from Stripe is `...000Z`; those are the
 * same moment in time but unequal as strings, so a naive `!==` reported spurious drift and
 * "repaired" every active subscriber on every reconcile pass. Contract:
 *  - both null → equal (both cleared, no drift).
 *  - exactly one null → not equal (one side set, the other cleared → genuine drift).
 *  - otherwise compare by epoch millis; if EITHER parses to NaN (corrupt/garbage value), fall back
 *    to exact string equality so a real mismatch between unparseable values is still surfaced
 *    rather than being silently collapsed to "same".
 */
export function sameInstant(a: string | null, b: string | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a === b;
  return ta === tb;
}

export function deriveProUntil(subs: Stripe.Subscription[]): DerivedProUntil {
  const activeSubs = subs.filter((s) => ACTIVE_STATUSES.has(s.status));
  const periodEnds = activeSubs
    .map((s) => subscriptionPeriodEnd(s))
    .filter((x): x is number => x != null);
  if (activeSubs.length > 0 && periodEnds.length === 0) return { skip: true };
  return { skip: false, proUntil: periodEnds.length ? new Date(Math.max(...periodEnds) * 1000).toISOString() : null };
}

/**
 * Reconcile one page of customers against Stripe, returning how many `pro_until` values we
 * repaired. A deleted/invalid customer (Stripe `resource_missing`) is logged and skipped so one
 * bad id can't fail the whole chunk's `step.run` — but every OTHER error (Stripe rate-limit /
 * network / auth, or a Supabase read/write fault) is re-thrown so the step retries the chunk
 * rather than silently reporting a "successful" run that repaired nothing.
 */
export async function reconcileCustomerChunk(
  sb: SupabaseClient,
  stripe: Stripe,
  customers: ReconcileCustomer[],
): Promise<{ chunkRepaired: number }> {
  let chunkRepaired = 0;
  for (const u of customers) {
    if (!u.stripe_customer_id) continue;
    let subs: { data: Stripe.Subscription[] };
    try {
      subs = await stripe.subscriptions.list({ customer: u.stripe_customer_id, status: 'all', limit: 100 });
    } catch (err) {
      if ((err as { code?: string })?.code === 'resource_missing') {
        console.error(`[reconcile] skipping deleted customer ${u.id} (${u.stripe_customer_id})`);
        continue;
      }
      throw err; // transient/systemic → let step.run retry the chunk
    }
    const derived = deriveProUntil(subs.data);
    if (derived.skip) continue;
    const { data: row, error: readErr } = await sb.from('users').select('pro_until').eq('id', u.id).maybeSingle();
    if (readErr) throw readErr;
    if (!sameInstant(row?.pro_until ?? null, derived.proUntil)) {
      const { error: writeErr } = await sb.from('users').update({ pro_until: derived.proUntil }).eq('id', u.id);
      if (writeErr) throw writeErr;
      chunkRepaired++;
    }
  }
  return { chunkRepaired };
}

export class LivemodeMismatchError extends Error {
  constructor(expect: boolean, actual: boolean) {
    super(`reconcile refused: expected Stripe livemode=${expect} but active key livemode=${actual}`);
    this.name = 'LivemodeMismatchError';
  }
}

/** Derive livemode from the active secret key prefix (`sk_live_` → true). */
export function keyLivemode(secretKey: string | undefined): boolean {
  return !!secretKey && secretKey.startsWith('sk_live_');
}

export type ReconcileMode = 'dry-run' | 'single-customer' | 'full';

export interface ReconcileEvent {
  data?: { mode?: ReconcileMode; customerId?: string };
}

export interface BuildReconcileOptsInput {
  /** The active Stripe secret key (its prefix decides livemode). */
  secretKey: string | undefined;
  /** `STRIPE_RECONCILE_LIVEMODE` env ('true'|'false'|unset). Unset = no livemode assertion. */
  livemodeEnv: string | undefined;
  /** The mode used when no event mode is supplied: 'dry-run' for the scheduled cron, 'full' for manual. */
  defaultMode: ReconcileMode;
  /** Present only for the manual function — carries the requested mode/customerId. */
  event?: ReconcileEvent;
}

/**
 * Pure builder for the {@link RunReconcileOpts} the inngest function wrappers pass to runReconcile.
 * Extracting the wiring here makes the single most dangerous decision — what mode a run uses and
 * whether the livemode guard is set — unit-testable, so a regression that hardcodes the scheduled
 * cron to a writing mode or drops the livemode assertion is caught by a test rather than in prod.
 */
export function buildReconcileOpts(input: BuildReconcileOptsInput): RunReconcileOpts {
  return {
    mode: input.event?.data?.mode ?? input.defaultMode,
    customerId: input.event?.data?.customerId,
    keyLivemode: keyLivemode(input.secretKey),
    expectLivemode: input.livemodeEnv == null ? undefined : input.livemodeEnv === 'true',
  };
}

export interface RunReconcileOpts {
  mode: ReconcileMode;
  keyLivemode: boolean;
  /** When set and != keyLivemode, the run is refused (deploy-time guard). */
  expectLivemode?: boolean;
  /** Required for single-customer mode: only this Stripe customer id is reconciled. */
  customerId?: string;
}

export interface ReconcileSummary {
  mode: ReconcileMode;
  checked: number;
  wouldRepair: number; // intended writes (all modes)
  repaired: number; // actual writes (0 for dry-run)
}

/**
 * Reconcile customers against Stripe with an explicit, testable safety contract:
 *  - dry-run (DEFAULT for the scheduled cron): compute + log intended writes, write nothing.
 *  - single-customer: only the named customer id is processed.
 *  - full: write the repairs.
 * A livemode mismatch (expectLivemode != active key) is refused outright. Per-customer
 * resource_missing is already skipped by reconcileCustomerChunk, so a wrong-mode key can never
 * null a live customer.
 */
export async function runReconcile(
  sb: SupabaseClient,
  stripe: Stripe,
  customers: ReconcileCustomer[],
  opts: RunReconcileOpts,
): Promise<ReconcileSummary> {
  if (opts.expectLivemode != null && opts.expectLivemode !== opts.keyLivemode) {
    throw new LivemodeMismatchError(opts.expectLivemode, opts.keyLivemode);
  }
  // A single-customer run with no id would filter to the empty set and report a misleading
  // "repaired: 0" success. Fail loudly so a malformed manual trigger can't masquerade as a
  // clean no-op.
  if (opts.mode === 'single-customer' && !opts.customerId) {
    throw new Error('single-customer mode requires customerId');
  }
  const scoped =
    opts.mode === 'single-customer'
      ? customers.filter((c) => c.stripe_customer_id === opts.customerId)
      : customers;

  if (opts.mode === 'dry-run') {
    let wouldRepair = 0;
    for (const u of scoped) {
      if (!u.stripe_customer_id) continue;
      let subs: { data: Stripe.Subscription[] };
      try {
        subs = await stripe.subscriptions.list({ customer: u.stripe_customer_id, status: 'all', limit: 100 });
      } catch (err) {
        if ((err as { code?: string })?.code === 'resource_missing') continue;
        throw err;
      }
      const derived = deriveProUntil(subs.data);
      if (derived.skip) continue;
      const { data: row } = await sb.from('users').select('pro_until').eq('id', u.id).maybeSingle();
      if (!sameInstant(row?.pro_until ?? null, derived.proUntil)) {
        wouldRepair++;
        console.log(`[reconcile:dry-run] would set ${u.id} pro_until=${derived.proUntil ?? 'null'}`);
      }
    }
    return { mode: opts.mode, checked: scoped.length, wouldRepair, repaired: 0 };
  }

  const { chunkRepaired } = await reconcileCustomerChunk(sb, stripe, scoped);
  return { mode: opts.mode, checked: scoped.length, wouldRepair: chunkRepaired, repaired: chunkRepaired };
}

export interface DeleteExpiredOpts {
  batchSize?: number;
  maxIterations?: number;
}
export interface DeleteExpiredResult {
  deleted: number;
  drained: boolean;
  iterations: number;
}

/**
 * Delete expired audits in bounded id-chunks instead of one unscoped statement. Selects up to
 * `batchSize` expired ids, deletes them by id, and loops until the set drains or `maxIterations`
 * is hit (a hard backstop so a clock/replication anomaly can't spin forever). `lte` matches a row
 * exactly at the expiry instant (complements listMine's `gt`).
 */
/**
 * SPEC 5.1a §8 — sweep ORPHANED frontier rows.
 *
 * WHY CASCADE + DELETE-AT-COMPLETION IS NOT ENOUGH, measured against live on 2026-08-06 rather than
 * assumed. `deleteExpiredAudits` below filters on `expires_at <= now` and NOTHING else, so an audit
 * whose `expires_at` is NULL is never deleted and its cascade never fires. Live counts at the time:
 * 20 completed and 2 cancelled with a NULL expiry, 7 pending (oldest stuck ~29 days) and 7 failed.
 * Between the happy path and the eventual TTL sit failed audits, cancelled audits, audits with no
 * expiry at all, and crawls whose worker died mid-flight — rows that would linger 30 days or FOREVER,
 * which is the ~300 MB shape the transient-rows design exists to avoid.
 *
 * THE PREDICATE AND THE CLOCK BOTH LIVE IN SQL (`delete_orphan_frontier_rows`, migration
 * 20260806000001), and neither is a parameter. A `p_ttl_hours` argument would put the constant back
 * here and leave two copies to keep in agreement — the hand-synchronised derivation class that has
 * already cost this project three defects. A `p_now` argument would be worse than duplication: any
 * caller could widen the rule to "everything", and a sweep that deletes live crawl state is
 * indistinguishable from data loss. So there is deliberately NO `FRONTIER_ORPHAN_TTL_HOURS` in this
 * file; the rule is stated once, in the migration, where the integration test executes it for real
 * against Postgres — including the assertion that it uses `frontier_updated_at_idx` rather than
 * full-scanning the largest table in the schema.
 *
 * What remains here is the BOUND: call the function until it drains, capped by `maxIterations` so a
 * clock or replication anomaly cannot spin forever. It rides the SAME daily cron as the audit sweep.
 */
export async function deleteOrphanFrontierRows(
  sb: SupabaseClient,
  opts: DeleteExpiredOpts = {},
): Promise<DeleteExpiredResult> {
  const batchSize = opts.batchSize ?? 500;
  const maxIterations = opts.maxIterations ?? 50;
  let deleted = 0;
  let iterations = 0;
  for (; iterations < maxIterations; iterations++) {
    const { data, error } = await sb.rpc('delete_orphan_frontier_rows', { p_batch_size: batchSize });
    if (error) throw error;
    const removed = typeof data === 'number' ? data : 0;
    deleted += removed;
    // A short batch means the set is drained; a full one means there may be more.
    if (removed < batchSize) return { deleted, drained: true, iterations: iterations + 1 };
  }
  return { deleted, drained: false, iterations };
}

export async function deleteExpiredAudits(
  sb: SupabaseClient,
  nowIso: string,
  opts: DeleteExpiredOpts = {},
): Promise<DeleteExpiredResult> {
  const batchSize = opts.batchSize ?? 500;
  const maxIterations = opts.maxIterations ?? 50;
  let deleted = 0;
  let iterations = 0;
  for (; iterations < maxIterations; iterations++) {
    const { data, error } = await sb
      .from('audits')
      .select('id')
      .lte('expires_at', nowIso)
      .order('expires_at', { ascending: true })
      .limit(batchSize);
    if (error) throw error;
    const ids = (data ?? []).map((r: { id: string }) => r.id);
    if (ids.length === 0) return { deleted, drained: true, iterations };
    const { error: delErr } = await sb.from('audits').delete().in('id', ids);
    if (delErr) throw delErr;
    deleted += ids.length;
    if (ids.length < batchSize) return { deleted, drained: true, iterations: iterations + 1 };
  }
  return { deleted, drained: false, iterations };
}
