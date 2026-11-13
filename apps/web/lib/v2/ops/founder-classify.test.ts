import { describe, expect, it } from 'vitest';
import { AccountStateSchema, type AccountState } from '@crawlmouse/types/v2';
import { classifyEntitlement, paymentLabel } from './founder-classify';

/**
 * Which entitlement changes the founder is told of at once (D3; plan §3 "C"; review C2). The table
 * below is written out from the plan, not derived from the code: every from × to of
 * AccountStateSchema's states is swept, and each pair not named here must notify nothing. Whether a
 * payment is the first is Stripe's to say (`paymentLabel`), not the account's history's.
 */
const STATES = AccountStateSchema.options;
const PAID = new Set<AccountState>(['pro', 'agency']);

function expected(from: AccountState, to: AccountState) {
  if (from === 'free' && to === 'pro_trial') return { kind: 'trial_started', plan: 'pro' };
  if (from === 'free' && to === 'agency_trial') return { kind: 'trial_started', plan: 'agency' };
  if (['free', 'pro_trial', 'agency_trial'].includes(from) && PAID.has(to))
    return { kind: 'payment', plan: to, recovery: false };
  // A failed charge settled: a trial whose first charge failed pays from past_due.
  if (from === 'past_due' && PAID.has(to)) return { kind: 'payment', plan: to, recovery: true };
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
        const got = classifyEntitlement(from, to);
        expect(got, `${from} → ${to}`).toEqual(expected(from, to));
        if (got !== null) notified += 1;
      }
    // free→2 trials, 4 froms × 2 paid states, 5 states → past_due.
    expect(notified).toBe(2 + 8 + 5);
  });
});

describe('paymentLabel', () => {
  it('is first with no earlier paid invoice, returning with one, and unlabelled when Stripe did not say', () => {
    expect(paymentLabel({ invoice: null, earlier: 'none' })).toBe('first');
    expect(paymentLabel({ invoice: null, earlier: 'some' })).toBe('returning');
    expect(paymentLabel({ invoice: null, earlier: 'unknown' })).toBe('unknown');
    expect(paymentLabel(null)).toBe('unknown');
  });
});
