import { describe, expect, it } from 'vitest';
import { AccountStateSchema, type AccountState } from '@crawlmouse/types/v2';
import { classifyEntitlement, type History } from './founder-classify';

/**
 * Which entitlement changes the founder is told of at once (D3; plan §3 "C"). The table below is
 * written out from the plan, not derived from the code: every from × to of AccountStateSchema's states
 * is swept, and each pair not named here must notify nothing.
 */
const STATES = AccountStateSchema.options;
const PAID = new Set<AccountState>(['pro', 'agency']);

const at = (n: number) => new Date(Date.UTC(2026, 10, 1, n)).toISOString();
const history = (...states: AccountState[]): History =>
  states.map((state, i) => ({ state, since: at(i) }));

/** What the plan says each pair is, given the account's history ends with that change. */
function expected(from: AccountState, to: AccountState) {
  if (from === 'free' && to === 'pro_trial') return { kind: 'trial_started', plan: 'pro' };
  if (from === 'free' && to === 'agency_trial') return { kind: 'trial_started', plan: 'agency' };
  if (['free', 'pro_trial', 'agency_trial'].includes(from) && PAID.has(to))
    return { kind: 'payment', plan: to, payment: 'first' };
  if (to === 'past_due' && from !== 'past_due') {
    const plan = { pro: 'pro', pro_trial: 'pro', agency: 'agency', agency_trial: 'agency' }[
      from as string
    ];
    return { kind: 'payment_failed', plan: plan ?? null };
  }
  return null;
}

describe('classifyEntitlement', () => {
  it('sweeps every from × to of the account states', () => {
    expect(STATES).toHaveLength(6);
    let notified = 0;
    for (const from of STATES)
      for (const to of STATES) {
        const got = classifyEntitlement(from, to, history('free', from, to));
        expect(got, `${from} → ${to}`).toEqual(expected(from, to));
        if (got !== null) notified += 1;
      }
    // free→2 trials, 3 froms × 2 paid states, 5 states → past_due.
    expect(notified).toBe(2 + 6 + 5);
  });

  it('calls a payment returning when the history holds an earlier paid state', () => {
    expect(
      classifyEntitlement('free', 'pro', history('free', 'pro', 'past_due', 'free', 'pro')),
    ).toEqual({ kind: 'payment', plan: 'pro', payment: 'returning' });
    expect(
      classifyEntitlement('free', 'agency', history('free', 'agency', 'free', 'agency')),
    ).toEqual({ kind: 'payment', plan: 'agency', payment: 'returning' });
  });

  it('reads the history from the change it names, not from where the account went after', () => {
    // free → pro, then past_due later: the payment is still the first.
    expect(classifyEntitlement('free', 'pro', history('free', 'pro', 'past_due'))).toEqual({
      kind: 'payment',
      plan: 'pro',
      payment: 'first',
    });
  });

  it('says the history was not read when it holds no such change', () => {
    expect(classifyEntitlement('pro_trial', 'pro', history('free', 'agency'))).toEqual({
      kind: 'payment',
      plan: 'pro',
      payment: 'unknown',
    });
    expect(classifyEntitlement('pro_trial', 'pro', [])).toEqual({
      kind: 'payment',
      plan: 'pro',
      payment: 'unknown',
    });
  });
});
