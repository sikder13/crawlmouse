/**
 * What a deletion says about the money, by the subscription mirror's status (fix round 3, item 4):
 * the one mapping Settings, its delete step and the deletion's confirmation page read.
 */
import { describe, expect, it } from 'vitest';
import { DELETE_COPY, deletionMoney, REFUND_POLICY } from './deletion';

const ENDS = ['active', 'trialing'] as const;
const NOT_COLLECTED = ['past_due', 'unpaid', 'paused'] as const;

describe('deletionMoney', () => {
  it('active or trialing: set to end when its current period ends, then the refund policy', () => {
    for (const s of ENDS) expect(deletionMoney(s)).toEqual([DELETE_COPY.moneyEnds, REFUND_POLICY]);
  });

  it('past due, unpaid or paused: cancelled at the erasure, then the refund policy', () => {
    for (const s of NOT_COLLECTED)
      expect(deletionMoney(s)).toEqual([DELETE_COPY.moneyNotCollected, REFUND_POLICY]);
  });

  it('any other state, a prototype key, or no subscription: nothing', () => {
    for (const s of ['canceled', 'incomplete', 'incomplete_expired', '__proto__', 'toString', null])
      expect(deletionMoney(s)).toBeNull();
  });

  it('the confirmation page’s default lines are the period-end ones', () => {
    expect(DELETE_COPY.money).toEqual([DELETE_COPY.moneyEnds, REFUND_POLICY]);
  });
});

describe('the wording holds for every state it is shown for', () => {
  it('the period-end sentence says nothing a trial has not done: no period “paid for”', () => {
    expect(DELETE_COPY.moneyEnds).not.toMatch(/paid for|you have paid/i);
  });

  it('the not-collected sentence does not call a paused plan a failed payment', () => {
    expect(DELETE_COPY.moneyNotCollected).not.toMatch(/fail/i);
  });
});
