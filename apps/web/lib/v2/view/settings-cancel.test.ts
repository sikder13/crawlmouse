/**
 * Cancel's second click on Settings › Plan (CC-39 D1, walk-findings item 6), and the billing portal
 * for an account Stripe knows. Dates worked out by hand: Northwind (challenged-site) is on Agency on
 * 31 Oct, its period ends 2026-11-01T14:00Z, Sun 1 Nov in Indianapolis; Example Outfitter (bad-site)
 * is on a Pro trial ending 2026-11-08T02:41Z, Sat 7 Nov there.
 */
import { describe, expect, it } from 'vitest';
import { ACCOUNT_VIEWERS } from '../../../app/(v2-preview)/v2-preview/_preview/accounts';
import { fixture } from '../fixtures';
import { cancelStepFrom, settingsView } from './settings';

const agency = fixture('challenged-site');
const onAgency = { accountId: ACCOUNT_VIEWERS.withheld().accountId, now: '2026-10-31T12:00:00Z' };
const trial = fixture('bad-site');
const onTrial = ACCOUNT_VIEWERS.home();

/** The dataset with the viewer's account's card unrecorded, as every live account has it (F8). */
function withoutCard(d: ReturnType<typeof fixture>, accountId: string) {
  return {
    ...d,
    accounts: d.accounts.map((a) => (a.id === accountId ? { ...a, card_last4: null } : a)),
  };
}

const cancelForms = (p: ReturnType<typeof settingsView>['plan']) =>
  [...p.terms.map((t) => t.action), p.confirm?.action ?? null].filter(
    (a) => a?.href === '/api/billing/cancel',
  );

describe('the cancel parameter', () => {
  it('reads confirm, and nothing else', () => {
    expect(cancelStepFrom('confirm')).toBe('confirm');
    for (const v of ['done', 'CONFIRM', '', undefined, ['confirm', 'confirm']])
      expect(cancelStepFrom(v)).toBeNull();
  });
});

describe('Cancel, the second click (D1)', () => {
  it('is not offered before the first click', () => {
    expect(settingsView(agency, onAgency, { role: 'owner' }).plan.confirm).toBeNull();
  });

  it('after it, says what ends and when, and posts confirm for the account in the Cancel row’s place', () => {
    const p = settingsView(agency, onAgency, { role: 'owner', cancelStep: 'confirm' }).plan;
    expect(p.confirm!.text).toBe(
      'Agency runs until Sun 1 Nov, then the account is on Free and nothing more is charged.',
    );
    expect(p.confirm!.action).toMatchObject({
      label: 'Yes, cancel Agency',
      href: '/api/billing/cancel',
      method: 'post',
      fields: { accountId: onAgency.accountId, confirm: 'true' },
    });
    // One cancel form on the page: the second click, which carries `confirm`.
    expect(cancelForms(p)).toEqual([p.confirm!.action]);
    expect(p.terms[0]!.action).toBeNull();
  });

  it('a subscription Stripe cancels at once is said to end now', () => {
    for (const status of ['past_due', 'unpaid', 'paused']) {
      const p = settingsView(agency, onAgency, {
        role: 'owner',
        cancelStep: 'confirm',
        subscriptionStatus: status,
      }).plan;
      expect(p.confirm!.text, status).toBe('Agency ends now, and the account is on Free.');
    }
  });

  it('an account past due: the Cancel row and its confirm both say it ends at once (review r1, item 2)', () => {
    // Northwind went past due on 1 Nov (state_history); on 2 Nov it is in its grace days.
    const pastDue = { accountId: onAgency.accountId, now: '2026-11-02T12:00:00Z' };
    const first = settingsView(agency, pastDue, {
      role: 'owner',
      subscriptionStatus: 'past_due',
    }).plan;
    expect(first.terms[0]!.text).toMatch(/^Two clicks, effective at once\./);
    expect(first.terms[0]!.action).toMatchObject({ href: '/api/billing/cancel' });
    const p = settingsView(agency, pastDue, {
      role: 'owner',
      subscriptionStatus: 'past_due',
      cancelStep: 'confirm',
    }).plan;
    expect(p.confirm!.text).toBe('Agency ends now, and the account is on Free.');
  });

  it('is the owner’s alone', () => {
    for (const role of ['account_manager', 'developer'] as const)
      expect(
        settingsView(agency, onAgency, { role, cancelStep: 'confirm' }).plan.confirm,
        role,
      ).toBeNull();
  });

  it('is not offered where there is nothing to cancel: Free, or a plan already ending', () => {
    expect(
      settingsView(fixture('clean-site'), ACCOUNT_VIEWERS.clean(), { cancelStep: 'confirm' }).plan
        .confirm,
    ).toBeNull();
    expect(
      settingsView(agency, onAgency, { cancelStep: 'confirm', billingEnd: '2026-12-10T15:00:00Z' })
        .plan.confirm,
    ).toBeNull();
  });
});

describe('a Checkout trial whose card was never recorded (F8; plan review finding 1)', () => {
  const trialing = { role: 'owner' as const, subscriptionStatus: 'trialing' };

  it('says the card is charged unless cancelled, and offers Cancel, not Keep', () => {
    const p = settingsView(trial, onTrial, trialing).plan;
    expect(p.note).toBe('Ends Sat 7 Nov. The card on file is charged then unless you cancel.');
    expect(p.note).not.toContain('No card on file');
    expect(p.keep).toBeNull();
    expect(p.terms[0]!.action).toMatchObject({ href: '/api/billing/cancel' });
  });

  it('confirms with the trial’s end', () => {
    const p = settingsView(trial, onTrial, { ...trialing, cancelStep: 'confirm' }).plan;
    expect(p.confirm!.text).toBe(
      'The Pro trial runs until Sat 7 Nov, then the account is on Free and the card is not charged.',
    );
  });

  it('a trial with no subscription is still the no-card trial, with nothing to cancel', () => {
    const p = settingsView(trial, onTrial, {
      role: 'owner',
      subscriptionStatus: null,
      cancelStep: 'confirm',
    }).plan;
    expect(p.note).toContain('No card on file');
    expect(p.terms[0]!.action).toBeNull();
    expect(p.confirm).toBeNull();
  });
});

describe('the billing portal, for every owner of an account Stripe knows (D1)', () => {
  const portalOf = (p: ReturnType<typeof settingsView>['plan']) => p.terms[1]!.action;
  const bare = withoutCard(agency, onAgency.accountId);

  it('a subscription without a recorded card: the portal, under the receipts sentence', () => {
    const p = settingsView(bare, onAgency, { role: 'owner', subscriptionStatus: 'active' }).plan;
    expect(portalOf(p)).toMatchObject({ label: 'Billing portal', href: '/api/billing/portal' });
    expect(p.terms[1]!.text).toBe(
      'Emailed by Stripe after each charge, and listed in the billing portal from here',
    );
  });

  it('no card and no subscription, or a preview with no card: none', () => {
    expect(portalOf(settingsView(bare, onAgency, { subscriptionStatus: null }).plan)).toBeNull();
    expect(portalOf(settingsView(bare, onAgency).plan)).toBeNull();
  });

  it('never for anyone but the owner', () => {
    const p = settingsView(bare, onAgency, {
      role: 'account_manager',
      subscriptionStatus: 'active',
    }).plan;
    expect(portalOf(p)).toBeNull();
  });
});
