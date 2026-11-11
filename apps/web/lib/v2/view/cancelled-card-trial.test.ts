/**
 * A trial with a card whose subscription is set to cancel at the trial's end (CC-27b review, item 1):
 * the card is not charged, so neither Settings nor Trial ending says it will be, and neither offers a
 * second cancel. bad-site's Pro trial ends 8 Nov 02:41Z, Sat 7 Nov 21:41 in Indiana; read on Settings
 * at the fixture's as_of and on Trial ending at the reminder.
 */
import { describe, expect, it } from 'vitest';
import { ACCOUNT_VIEWERS } from '../../../app/(v2-preview)/v2-preview/_preview/accounts';
import { fixture } from '../fixtures';
import { settingsView } from './settings';
import { trialEndViewer, trialPage } from './trial-end';

const BAD = 'a0000000-0000-4000-8000-000000000001';
const bad = fixture('bad-site');
const ENDS = bad.accounts.find((a) => a.id === BAD)!.trial_ends_at!;
const card = {
  ...bad,
  accounts: bad.accounts.map((a) =>
    a.id === BAD ? { ...a, card_last4: '4242', billing_period_months: 1 } : a,
  ),
};
const CHARGE = /charged (then|on)|unless you cancel|Cancel before/;

describe('Settings, a card trial set to cancel', () => {
  const view = () => settingsView(card, ACCOUNT_VIEWERS.home(), { billingEnd: ENDS });
  const p = () => view().plan;

  it('says the trial ends with no charge, and offers no cancel', () => {
    expect(ENDS).toBe('2026-11-08T02:41:00Z');
    expect(p().note).toBe(
      'Pro trial until Sat 7 Nov, then Free. The card ending 4242 is not charged.',
    );
    expect(p().terms[0]).toEqual({
      label: 'Cancel',
      text: 'Cancelled; the trial ends Sat 7 Nov and the card is not charged.',
      action: null,
    });
    expect(JSON.stringify(view())).not.toMatch(CHARGE);
  });

  it('without the end, the card trial is charged unless cancelled, as before', () => {
    expect(settingsView(card, ACCOUNT_VIEWERS.home()).plan.note).toMatch(
      /charged then unless you cancel/,
    );
  });
});

describe('Trial ending, a card trial set to cancel', () => {
  const read = () => {
    const shown = trialPage(card, trialEndViewer(card, BAD), { billingEnd: ENDS });
    if (shown?.kind !== 'before') throw new Error('expected the before state');
    return shown.view;
  };

  it('says the trial is cancelled and the card not charged, with no cancel to make', () => {
    const v = read();
    expect(v.banner.sub).toBe(
      'The reminder goes out once, today, unless you turned it off. The trial is cancelled: it ends on Sat 7 Nov and the card ending 4242 is not charged.',
    );
    expect(v.banner.keep).toBeNull();
    expect(v.banner.end).toMatchObject({ label: 'Let it end on Sat 7 Nov', href: '/dashboard' });
    expect(v.keepTitle).toBe('If you do nothing');
    expect(v.keepText).toMatch(
      /^The trial ends on Sat 7 Nov and the card ending 4242 is not charged\. /,
    );
    expect(v.endTitle).toBe('If you let it end');
    expect(v.endText).toMatch(/^Nothing to do\. On Sat 7 Nov the account is Free:/);
    expect(JSON.stringify(v)).not.toMatch(CHARGE);
  });

  it('without the end, the card is charged unless the trial is cancelled, as before', () => {
    const shown = trialPage(card, trialEndViewer(card, BAD));
    expect(shown?.kind === 'before' && shown.view.banner.sub).toMatch(
      /charged on Sat 7 Nov unless you cancel/,
    );
  });
});
