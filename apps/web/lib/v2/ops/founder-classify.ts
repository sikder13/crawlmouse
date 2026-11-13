/**
 * Which entitlement changes the founder is told of at once (CC-33 D3), from `entitlement.changed`'s
 * `from` and `to` and the account's `state_history` as read when the notice is sent:
 *
 *   free → pro_trial, free → agency_trial             trial started (Pro, Agency)
 *   free, pro_trial or agency_trial → pro or agency   payment: `first` when the history holds no paid
 *                                                     state before this change, else `returning`;
 *                                                     `unknown` when the history holds no such change
 *   any other state → past_due                        payment failed (the plan of the state left)
 *
 * Every other change reaches the founder in the digest only.
 */
import type { AccountState } from '@crawlmouse/types/v2';

export type History = readonly { state: AccountState; since: string }[];
export type Plan = 'pro' | 'agency';

export type FounderEntitlement =
  | { kind: 'trial_started'; plan: Plan }
  | { kind: 'payment'; plan: Plan; payment: 'first' | 'returning' | 'unknown' }
  | { kind: 'payment_failed'; plan: Plan | null };

const PLAN_OF: Partial<Record<AccountState, Plan>> = {
  pro_trial: 'pro',
  pro: 'pro',
  agency_trial: 'agency',
  agency: 'agency',
};
const BEFORE_PAID = new Set<AccountState>(['free', 'pro_trial', 'agency_trial']);
/** States an account is only in after it has paid. */
const PAID_STATES = new Set<AccountState>(['pro', 'agency', 'past_due']);

/** Whether the history's last `from` → `to` change follows a paid state; null when it holds none. */
function paidBefore(history: History, from: AccountState, to: AccountState): boolean | null {
  for (let i = history.length - 1; i > 0; i--) {
    if (history[i]!.state === to && history[i - 1]!.state === from) {
      return history.slice(0, i).some((h) => PAID_STATES.has(h.state));
    }
  }
  return null;
}

export function classifyEntitlement(
  from: AccountState,
  to: AccountState,
  history: History,
): FounderEntitlement | null {
  if (from === 'free' && (to === 'pro_trial' || to === 'agency_trial')) {
    return { kind: 'trial_started', plan: PLAN_OF[to]! };
  }
  if (BEFORE_PAID.has(from) && (to === 'pro' || to === 'agency')) {
    const before = paidBefore(history, from, to);
    return {
      kind: 'payment',
      plan: to,
      payment: before === null ? 'unknown' : before ? 'returning' : 'first',
    };
  }
  if (to === 'past_due' && from !== 'past_due') {
    return { kind: 'payment_failed', plan: PLAN_OF[from] ?? null };
  }
  return null;
}
