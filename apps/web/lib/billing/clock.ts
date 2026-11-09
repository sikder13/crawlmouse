/**
 * Our clock for v2 billing (CC-03 D9): the entitlement events that come from us rather than from
 * Stripe — a no-card trial's reminder and its end, and the end of a past-due grace — applied to an
 * account and planned, for trialLifecycleFn and pastDueSweepFn (inngest/), which reach them through
 * `billingClock` and send each plan in a step of its own.
 *
 * `applyClockEvent` does not send. Its plan's event ids are fixed by the account and the moment the
 * event is about (the trial's end, or when the account fell past due), so the lifecycle's expiry and
 * the sweep's backstop expiry of one trial send one `entitlement.changed` between them.
 *
 * The sweep's read only narrows: the machine decides each account on the account as it is read when
 * the event is applied.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SweepCandidate, SweepClock } from '../../../../inngest/past-due-sweep';
import type { TrialClock } from '../../../../inngest/trial-lifecycle';
import { PAST_DUE_GRACE_DAYS } from '../entitlement-v2';
import {
  dispatchPlanned,
  planEffects,
  PlannedEffectsSchema,
  type EffectSinks,
  type PlannedEffect,
} from './effects';
import { applyEntitlementTransition, type EntitlementStore } from './state-machine-apply';
import type { EntitlementEvent, EntitlementSnapshot } from './state-machine';

const DAY_MS = 86_400_000;
const GRACE_MS = PAST_DUE_GRACE_DAYS * DAY_MS;

/** The events our clock applies. */
export type ClockEvent = Extract<
  EntitlementEvent,
  { type: 'trial_reminder_due' | 'trial_expired' | 'past_due_lapsed' }
>;

/** What one clock event did: JSON as it is, so it can be an Inngest step's output. */
export interface ClockOutcome {
  outcome: 'applied' | 'ignored';
  /** The machine's reason for an ignored event; null when it applied. */
  reason: string | null;
  planned: PlannedEffect[];
}

/** The plan's source: the event's kind and the moment it is about, read from the account. */
function clockSource(event: ClockEvent, before: EntitlementSnapshot): string {
  const [kind, moment] =
    event.type === 'past_due_lapsed'
      ? ['past-due-lapsed', before.pastDueSince]
      : [event.type === 'trial_expired' ? 'trial-expired' : 'trial-reminder', before.trialEndsAt];
  if (moment === null)
    throw new Error(`${event.type} had effects on an account it does not apply to`);
  return `${kind}:${moment.toISOString()}`;
}

/** Applies one of our clock's events through the machine and plans its effects; sends nothing. */
export async function applyClockEvent(
  store: EntitlementStore,
  accountId: string,
  event: ClockEvent,
): Promise<ClockOutcome> {
  const { before, transition } = await applyEntitlementTransition(store, accountId, event);
  const planned =
    transition.effects.length === 0
      ? []
      : planEffects(transition.effects, {
          accountId,
          source: clockSource(event, before),
          before,
          after: transition.state,
        });
  return {
    outcome: transition.outcome,
    reason: transition.outcome === 'ignored' ? transition.reason : null,
    planned,
  };
}

/** An account the sweep may change, with the column its narrowing is on. */
export interface SweepRow {
  accountId: string;
  /** `past_due_since`, or `trial_ends_at`. */
  at: Date;
}

/** The sweep's narrowing reads. Each answers at most `limit` rows, oldest `at` first. */
export interface SweepReads {
  /** `past_due` accounts whose `past_due_since` is before `before`. */
  pastDueBefore(before: Date, limit: number): Promise<SweepRow[]>;
  /** `pro_trial` accounts on the `no_card` variant whose `trial_ends_at` is at or before `by`. */
  noCardTrialsEndedBy(by: Date, limit: number): Promise<SweepRow[]>;
}

/** The reads through PostgREST; `sb` must be the service-role client. */
export function supabaseSweepReads(sb: SupabaseClient): SweepReads {
  const rows = (
    result: { data: Record<string, string>[] | null; error: { message: string } | null },
    column: 'past_due_since' | 'trial_ends_at',
  ): SweepRow[] => {
    if (result.error) throw new Error(`sweep read failed: ${result.error.message}`);
    return (result.data ?? []).map((r) => ({ accountId: r.id!, at: new Date(r[column]!) }));
  };
  return {
    async pastDueBefore(before, limit) {
      const result = await sb
        .from('accounts')
        .select('id, past_due_since')
        .eq('state', 'past_due')
        .lt('past_due_since', before.toISOString())
        .order('past_due_since', { ascending: true })
        .order('id', { ascending: true })
        .limit(limit);
      return rows(result, 'past_due_since');
    },
    async noCardTrialsEndedBy(by, limit) {
      const result = await sb
        .from('accounts')
        .select('id, trial_ends_at')
        .eq('state', 'pro_trial')
        .eq('trial_variant', 'no_card')
        .lte('trial_ends_at', by.toISOString())
        .order('trial_ends_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(limit);
      return rows(result, 'trial_ends_at');
    },
  };
}

/**
 * The accounts the sweep at `at` looks at: past due since before the grace, and no-card trials that
 * have ended; at most `limit`, the longest overdue first (overdue from the end of the grace, or of the
 * trial).
 */
export async function sweepCandidates(
  reads: SweepReads,
  at: Date,
  limit: number,
): Promise<SweepCandidate[]> {
  const [pastDue, ended] = await Promise.all([
    reads.pastDueBefore(new Date(at.getTime() - GRACE_MS), limit),
    reads.noCardTrialsEndedBy(at, limit),
  ]);
  const due = [
    ...pastDue.map((r) => ({ ...r, kind: 'lapse' as const, dueAt: r.at.getTime() + GRACE_MS })),
    ...ended.map((r) => ({ ...r, kind: 'expire' as const, dueAt: r.at.getTime() })),
  ];
  due.sort((a, b) => a.dueAt - b.dueAt || a.accountId.localeCompare(b.accountId));
  return due.slice(0, limit).map(({ accountId, kind }) => ({ accountId, kind }));
}

export interface ClockDeps {
  store: EntitlementStore;
  reads: SweepReads;
  sinks: EffectSinks;
  now: () => number;
}

/** What the trial and sweep functions' steps call. */
export function billingClock(deps: ClockDeps): TrialClock & SweepClock {
  return {
    now: deps.now,
    candidates: (at, limit) => sweepCandidates(deps.reads, at, limit),
    remind: (accountId, at) =>
      applyClockEvent(deps.store, accountId, { type: 'trial_reminder_due', at }),
    expire: (accountId, at) =>
      applyClockEvent(deps.store, accountId, { type: 'trial_expired', at }),
    lapse: (accountId, at) =>
      applyClockEvent(deps.store, accountId, { type: 'past_due_lapsed', at }),
    // The plan comes back from Inngest's record of the deciding step: read it as strictly as a
    // stored plan is, so a malformed one is refused whole rather than half sent.
    dispatch: async (planned) => dispatchPlanned(PlannedEffectsSchema.parse(planned), deps.sinks),
  };
}
