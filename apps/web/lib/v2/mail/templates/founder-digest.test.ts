import { describe, expect, it } from 'vitest';
import { change, DIGEST_FIGURES, founderDigest, type DigestCounts } from './founder-digest';

const counts = (base: number): DigestCounts =>
  Object.fromEntries(DIGEST_FIGURES.map(([k], i) => [k, base + i])) as DigestCounts;

describe('founderDigest', () => {
  it('names the figures exactly as founder_digest_counts computes them', () => {
    expect(DIGEST_FIGURES.map(([k]) => k)).toEqual([
      'signups_confirmed',
      'trials_started',
      'trials_ended',
      'payments_paid',
      'plans_started_unpaid',
      'payments_failed',
      'cancellations',
      'checks_run_all',
      'checks_failed_all',
      'mail_bounce_events',
      'mail_suppressions_new',
      'mail_send_failures',
    ]);
    const labels = Object.fromEntries(DIGEST_FIGURES);
    expect(labels.checks_run_all).toBe('Checks run (all, incl. anonymous)');
    // review N4, M1: a payment is counted when Stripe's invoice was paid at the plan change; a card
    // trial's conversion, charged about an hour later, is a plan start with the invoice unpaid.
    expect(labels.payments_paid).toBe(
      'Payments: payment notices whose Stripe invoice was already paid when the plan changed (a card trial’s first charge clears about an hour after its plan starts, so it is not counted here but under plans started unpaid; a failed charge settled later is counted only when it was the first payment)',
    );
    expect(labels.plans_started_unpaid).toBe(
      'Plans started with the invoice not yet paid or not read from Stripe',
    );
  });

  it('daily: the day, each figure with its count, and what is left out', () => {
    const m = founderDigest({ variant: 'daily', date: '2026-11-01', counts: counts(1) });
    expect(m.subject).toBe('Crawlmouse daily: 2026-11-01');
    DIGEST_FIGURES.forEach(([, label], i) => {
      expect(m.text).toContain(`${label}: ${i + 1}`);
      expect(m.html).toContain(label);
    });
    expect(m.text).toContain(
      'Internal accounts are left out of the sign-up, trial, payment, cancellation, check and send-failure figures',
    );
    expect(m.text).toContain('they include internal accounts’ mail');
  });

  it('weekly: this week, the week before and the change, for each figure', () => {
    const week = { ...counts(10), payments_failed: 2, cancellations: 4 };
    const previous = { ...counts(10), payments_failed: 5, cancellations: 4, trials_started: 1 };
    const m = founderDigest({ variant: 'weekly', monday: '2026-10-26', week, previous });
    expect(m.subject).toBe('Crawlmouse weekly: week of 2026-10-26');
    expect(m.text).toContain('Payments failed: 2 (week before 5, change −3)');
    expect(m.text).toContain('Cancellations: 4 (week before 4, change 0)');
    expect(m.text).toContain('Trials started: 11 (week before 1, change +10)');
    expect(m.text.split('\n').filter((l) => l.includes('(week before '))).toHaveLength(
      DIGEST_FIGURES.length,
    );
  });

  it('writes a change with its sign', () => {
    expect(change(5, 2)).toBe('+3');
    expect(change(2, 5)).toBe('−3');
    expect(change(1200, 0)).toBe('+1,200');
    expect(change(4, 4)).toBe('0');
  });
});
