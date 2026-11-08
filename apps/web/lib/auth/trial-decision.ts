/**
 * The no-card trial's one database call, `start_trial_with_ledger` (migration 006c,
 * docs/specs/v2/06c-trial-function.md): what is sent, and what comes back, read strictly so an
 * answer the code does not expect is a failure rather than a guess.
 */
import type { TransitionParams } from '../billing/state-machine-apply';
import { LEDGER_KINDS, type LedgerKind } from './ledger';

/** `apply_entitlement_transition`'s arguments for the trial, as next() computed them, and the event. */
export type TrialTransition = { event: 'trial_started' } & TransitionParams;

export type TrialDecision =
  | { outcome: 'started' | 'not_eligible'; hits: [] }
  | { outcome: 'refused'; hits: LedgerKind[] };

export class MalformedTrialDecisionError extends Error {
  constructor() {
    super('start_trial_with_ledger answered something that is not a decision');
    this.name = 'MalformedTrialDecisionError';
  }
}

const isKind = (v: unknown): v is LedgerKind =>
  typeof v === 'string' && (LEDGER_KINDS as readonly string[]).includes(v);

/** The function's jsonb answer: `{outcome, hits}`, nothing more; a refusal names one kind or more. */
export function parseTrialDecision(raw: unknown): TrialDecision {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new MalformedTrialDecisionError();
  }
  const keys = Object.keys(raw).sort();
  const { outcome, hits } = raw as { outcome?: unknown; hits?: unknown };
  if (keys.join() !== 'hits,outcome' || !Array.isArray(hits) || !hits.every(isKind)) {
    throw new MalformedTrialDecisionError();
  }
  if (outcome === 'refused' && hits.length > 0) return { outcome, hits };
  if ((outcome === 'started' || outcome === 'not_eligible') && hits.length === 0) {
    return { outcome, hits: [] };
  }
  throw new MalformedTrialDecisionError();
}
