/**
 * What the v2 Stripe webhook (./stripe-webhook.ts) reads and writes, as a port: the `stripe_events`
 * ledger, the account and mirror lookups, and the `apply_stripe_event` RPC (migration
 * 20261110000001), which writes a decision, its transition, the subscription mirror and the planned
 * effects in one transaction. `supabaseWebhookDb` is the port over PostgREST with the service role;
 * the tests and the sandbox smoke use `./webhook-db.pglite.ts`.
 *
 * `eventStore` and `recordDecision` are the two ways a decision reaches the RPC: through the
 * entitlement machine (`applyEntitlementTransition` with a store for one event), or recorded
 * without it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { PlannedEffectsSchema, type PlannedEffect } from './effects';
import type { EntitlementSnapshot, Transition } from './state-machine';
import {
  EntitlementConflictError,
  supabaseEntitlementStore,
  type EntitlementStore,
  type StoredSnapshot,
  type TransitionParams,
} from './state-machine-apply';
import type { MirrorRow, StoredMirror } from './subscription-mirror';

/** The ledger row's key and the two columns written when it is first seen. */
export interface LedgerEvent {
  id: string;
  type: string;
  livemode: boolean;
}

export type LedgerState =
  /** First seen: the row was inserted. */
  | { kind: 'new' }
  /** Seen before, no decision recorded. */
  | { kind: 'retry' }
  /** Decided, but its effects were not confirmed sent. */
  | { kind: 'decided'; effects: PlannedEffect[] }
  /** `processed_at` is set. */
  | { kind: 'processed' };

/** What a decision writes besides the account. */
export interface EventWrite {
  eventId: string;
  /** Stripe's `event.created`. */
  created: Date;
  accountId: string | null;
  /** The checkout's customer, to bind to an account that has none. */
  bindCustomer: string | null;
  /** The subscription row to lock, whether the out-of-order guard applies, and its new columns. */
  subscription: { id: string; gated: boolean; mirror: MirrorRow | null } | null;
}

/** `apply_stripe_event`'s argument. */
export interface ApplyEventParams {
  event_id: string;
  event_created: string;
  account_id: string | null;
  customer_id: string | null;
  subscription: EventWrite['subscription'];
  transition: TransitionParams | null;
  expected_version: number | null;
  handled: boolean;
  handled_reason: string | null;
  effects: PlannedEffect[];
}

/** What `apply_stripe_event` recorded, or what an earlier call had recorded (`decidedBefore`). */
export interface RecordedDecision {
  decidedBefore: boolean;
  /** Null on a row with `processed_at` and no decision, as v1's handler leaves one. */
  handled: boolean | null;
  reason: string | null;
  effects: PlannedEffect[];
  /** The account's entitlement version after the call; null without an account. */
  version: number | null;
}

/** The customer to bind is on another account, or the account has another one (SQLSTATE 23505). */
export class BindingConflictError extends Error {
  constructor(eventId: string) {
    super(`the customer of stripe event ${eventId} is bound elsewhere`);
    this.name = 'BindingConflictError';
  }
}

export interface WebhookDb {
  begin(event: LedgerEvent): Promise<LedgerState>;
  /** Writes the row undecided (`handled` and `processed_at` null) with the reason; a row already there is left. */
  recordRefused(event: LedgerEvent, reason: 'livemode_mismatch'): Promise<void>;
  /** A live account, or null. */
  accountById(id: string): Promise<{ id: string; stripeCustomerId: string | null } | null>;
  /** The live account bound to a customer, or null. */
  accountByCustomer(customerId: string): Promise<string | null>;
  subscriptionById(id: string): Promise<StoredMirror | null>;
  load(accountId: string): Promise<StoredSnapshot | null>;
  /** The RPC. Throws EntitlementConflictError on 40001 and BindingConflictError on 23505. */
  applyEvent(p: ApplyEventParams): Promise<RecordedDecision>;
  /** Sets `processed_at` on a decided row that has none. */
  stamp(eventId: string): Promise<void>;
}

// ─── Shared by every adapter ─────────────────────────────────────────────────────────────────────

/** The ledger state of an existing row. */
export function ledgerStateOf(row: {
  handled: boolean | null;
  processed_at: string | Date | null;
  effects: unknown;
}): LedgerState {
  if (row.processed_at !== null) return { kind: 'processed' };
  if (row.handled !== null) {
    return { kind: 'decided', effects: PlannedEffectsSchema.parse(row.effects ?? []) };
  }
  return { kind: 'retry' };
}

/** The RPC's answer, checked: a stored plan that does not parse is refused whole. */
export function recordedDecisionOf(json: unknown): RecordedDecision {
  const r = json as {
    decided?: unknown;
    handled?: unknown;
    reason?: unknown;
    effects?: unknown;
    version?: unknown;
  };
  if (
    typeof r?.decided !== 'boolean' ||
    !(typeof r.handled === 'boolean' || r.handled === null) ||
    !(typeof r.reason === 'string' || r.reason === null) ||
    !(typeof r.version === 'number' || r.version === null)
  ) {
    throw new Error('apply_stripe_event answered an unexpected shape');
  }
  return {
    decidedBefore: r.decided,
    handled: r.handled,
    reason: r.reason,
    effects: PlannedEffectsSchema.parse(r.effects),
    version: r.version,
  };
}

/** The error a failed RPC call stands for. */
export function applyEventError(
  code: string | undefined,
  message: string,
  p: ApplyEventParams,
): Error {
  if (code === '40001') return new EntitlementConflictError(p.account_id ?? 'none');
  if (code === '23505') return new BindingConflictError(p.event_id);
  return Object.assign(new Error(`apply_stripe_event failed: ${message}`), { code });
}

function baseParams(write: EventWrite) {
  return {
    event_id: write.eventId,
    event_created: write.created.toISOString(),
    account_id: write.accountId,
    customer_id: write.bindCustomer,
    subscription: write.subscription,
  };
}

/** Records a decision that did not go through the machine: `handled` false, no version read. */
export function recordDecision(
  db: WebhookDb,
  write: EventWrite,
  reason: string,
  effects: PlannedEffect[],
): Promise<RecordedDecision> {
  return db.applyEvent({
    ...baseParams(write),
    transition: null,
    expected_version: null,
    handled: false,
    handled_reason: reason,
    effects,
  });
}

/** The effects a transition plans, given the snapshot it was decided on. */
export type Planner = (
  before: EntitlementSnapshot,
  transition: Transition,
) => Promise<PlannedEffect[]>;

export interface EventStore extends EntitlementStore {
  /** What the RPC recorded; null until `commit` or `confirm` has run. */
  recorded(): RecordedDecision | null;
}

/**
 * The entitlement store for one event: `commit` and `confirm` write the transition, or check the
 * version it was decided on, through `apply_stripe_event`, together with `write` and the effects
 * `plan` makes of the transition and the snapshot `load` read.
 */
export function eventStore(db: WebhookDb, write: EventWrite, plan: Planner): EventStore {
  let loaded: EntitlementSnapshot | null = null;
  let recorded: RecordedDecision | null = null;

  async function decide(
    accountId: string,
    transition: Transition | undefined,
    at: Pick<ApplyEventParams, 'transition' | 'expected_version'>,
  ): Promise<RecordedDecision> {
    if (transition === undefined)
      throw new Error('the webhook store is given the transition it writes');
    if (loaded === null) throw new Error('the webhook store decides only on a snapshot it loaded');
    if (accountId !== write.accountId)
      throw new Error('the webhook store writes its own account only');
    const effects = await plan(loaded, transition);
    recorded = await db.applyEvent({
      ...baseParams(write),
      ...at,
      handled: transition.outcome === 'applied',
      handled_reason: transition.outcome === 'ignored' ? transition.reason : null,
      effects,
    });
    return recorded;
  }

  return {
    async load(accountId) {
      const stored = await db.load(accountId);
      loaded = stored?.snapshot ?? null;
      return stored;
    },
    async commit(params, transition) {
      const r = await decide(params.p_account_id, transition, {
        transition: params,
        expected_version: null,
      });
      if (r.version === null) throw new Error('apply_stripe_event answered no version');
      return r.version;
    },
    async confirm(accountId, version, transition) {
      await decide(accountId, transition, { transition: null, expected_version: version });
    },
    recorded: () => recorded,
  };
}

// ─── Supabase ────────────────────────────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function failed(what: string, error: { message: string }): never {
  throw new Error(`${what} failed: ${error.message}`);
}

/** The port over PostgREST; `sb` must be the service-role client. */
export function supabaseWebhookDb(sb: SupabaseClient): WebhookDb {
  const entitlement = supabaseEntitlementStore(sb);
  return {
    async begin({ id, type, livemode }) {
      const { error } = await sb.from('stripe_events').insert({ id, type, livemode });
      if (!error) return { kind: 'new' };
      if (error.code !== '23505') failed('stripe_events insert', error);
      const { data, error: readError } = await sb
        .from('stripe_events')
        .select('handled, processed_at, effects')
        .eq('id', id)
        .maybeSingle();
      if (readError) failed('stripe_events read', readError);
      if (!data) throw new Error(`stripe_events row ${id} is gone`);
      return ledgerStateOf(data);
    },
    async recordRefused({ id, type, livemode }, reason) {
      const { error } = await sb
        .from('stripe_events')
        .upsert(
          { id, type, livemode, handled_reason: reason },
          { onConflict: 'id', ignoreDuplicates: true },
        );
      if (error) failed('stripe_events refusal', error);
    },
    async accountById(id) {
      if (!UUID.test(id)) return null;
      const { data, error } = await sb
        .from('accounts')
        .select('id, stripe_customer_id')
        .eq('id', id)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) failed('accounts read', error);
      return data
        ? { id: data.id as string, stripeCustomerId: data.stripe_customer_id as string | null }
        : null;
    },
    async accountByCustomer(customerId) {
      const { data, error } = await sb
        .from('accounts')
        .select('id')
        .eq('stripe_customer_id', customerId)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) failed('accounts read', error);
      return data ? (data.id as string) : null;
    },
    async subscriptionById(id) {
      const { data, error } = await sb
        .from('subscriptions')
        .select('account_id, plan, interval, seat_quantity, extra_site_quantity')
        .eq('id', id)
        .maybeSingle();
      if (error) failed('subscriptions read', error);
      return data ? storedMirrorOf(data) : null;
    },
    load: (accountId) => entitlement.load(accountId),
    async applyEvent(p) {
      const { data, error } = await sb.rpc('apply_stripe_event', { p });
      if (error) throw applyEventError(error.code, error.message, p);
      return recordedDecisionOf(data);
    },
    async stamp(eventId) {
      const { error } = await sb
        .from('stripe_events')
        .update({ processed_at: new Date().toISOString() })
        .eq('id', eventId)
        .not('handled', 'is', null)
        .is('processed_at', null);
      if (error) failed('stripe_events stamp', error);
    },
  };
}

/** A `subscriptions` row's plan columns as the port returns them. */
export function storedMirrorOf(row: {
  account_id: unknown;
  plan: unknown;
  interval: unknown;
  seat_quantity: unknown;
  extra_site_quantity: unknown;
}): StoredMirror {
  if (
    typeof row.account_id !== 'string' ||
    (row.plan !== 'pro' && row.plan !== 'agency') ||
    (row.interval !== 'month' && row.interval !== 'year') ||
    typeof row.seat_quantity !== 'number' ||
    typeof row.extra_site_quantity !== 'number'
  ) {
    throw new Error('a subscriptions row does not read as a mirror');
  }
  return {
    accountId: row.account_id,
    plan: row.plan,
    interval: row.interval,
    seatQuantity: row.seat_quantity,
    extraSiteQuantity: row.extra_site_quantity,
  };
}
