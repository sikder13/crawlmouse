/**
 * A Checkout trial whose card's last four digits were never recorded (CC-39 ruling 1, walk-findings
 * item 7): its subscription is `trialing` and renews at the trial's end, so neither Settings › Plan nor
 * the rail's trial card says "No card on file" or that the account stays on Free, and the rail offers
 * no Keep. Example Outfitter (bad-site) is on a Pro trial ending Sat 7 Nov in Indianapolis; as the
 * fixture has it, it is a trial with no card and no subscription.
 */
import { describe, expect, it } from 'vitest';
import { ACCOUNT_VIEWERS } from '../../../app/(v2-preview)/v2-preview/_preview/accounts';
import { fixture } from '../fixtures';
import { deleteStepView, settingsView } from './settings';
import { trialEndView, trialEndViewer } from './trial-end';

const plain = fixture('bad-site');
const viewer = ACCOUNT_VIEWERS.home();
const day0 = ACCOUNT_VIEWERS.day0();

/** The same account with a trialing subscription: `renews_at` is its period end, the trial's end. */
const checkoutTrial = {
  ...plain,
  accounts: plain.accounts.map((a) =>
    a.id === viewer.accountId ? { ...a, card_last4: null, renews_at: a.trial_ends_at } : a,
  ),
};

const FALSE = /No card on file|stays on Free|Then Free/;

describe('a Checkout trial with no recorded card', () => {
  it('the rail, after its first run: the card is charged at the end, and no Keep', () => {
    const card = deleteStepView(checkoutTrial, viewer, { role: 'owner' }).shell.trial!;
    expect(card.note).toBe('The card on file is charged on Sat 7 Nov unless you cancel.');
    expect(card.keep).toBeNull();
  });

  it('the rail, on its first run: the same, not "No card on file"', () => {
    const card = deleteStepView(checkoutTrial, day0, { role: 'owner' }).shell.trial!;
    expect(card.note).not.toMatch(FALSE);
    expect(card.note).toBe('The card on file is charged on Sat 7 Nov unless you cancel.');
  });

  it('the card on the page that carries the plan (Trial ending)', () => {
    const accountId = viewer.accountId;
    const card = trialEndView(checkoutTrial, trialEndViewer(checkoutTrial, accountId), {
      role: 'owner',
    }).shell.trial!;
    expect(card.note).not.toMatch(FALSE);
    expect(card.note).toContain('The card on file is charged on');
  });

  it('Settings › Plan, read with the subscription’s status: the plan card and its rail card', () => {
    const v = settingsView(checkoutTrial, viewer, {
      role: 'owner',
      subscriptionStatus: 'trialing',
    });
    expect(v.plan.note).not.toMatch(FALSE);
    expect(v.shell.trial!.note).not.toMatch(FALSE);
  });
});

describe('a Checkout trial set to cancel, with no recorded card (review r1, item 1)', () => {
  // Set to cancel: the subscription is still trialing, renews_at is null, and billingEnd is the end.
  const cancelling = {
    ...plain,
    accounts: plain.accounts.map((a) =>
      a.id === viewer.accountId ? { ...a, card_last4: null, renews_at: null } : a,
    ),
  };
  const end = plain.accounts.find((a) => a.id === viewer.accountId)!.trial_ends_at!;
  const NOT_CHARGED = 'The trial ends on Sat 7 Nov and the card on file is not charged.';

  it('Settings › Plan: the trial card agrees with the plan card that the card is not charged', () => {
    const v = settingsView(cancelling, viewer, {
      role: 'owner',
      subscriptionStatus: 'trialing',
      billingEnd: end,
    });
    expect(v.shell.trial!.note).toBe(NOT_CHARGED);
    expect(v.plan.note).toBe(
      'Pro trial until Sat 7 Nov, then Free. The card on file is not charged.',
    );
  });

  it('Trial ending: the same', () => {
    const card = trialEndView(cancelling, trialEndViewer(cancelling, viewer.accountId), {
      role: 'owner',
      billingEnd: end,
    }).shell.trial!;
    expect(card.note).toBe(NOT_CHARGED);
  });
});

describe('the control: a trial with no card and no subscription is unchanged', () => {
  it('the rail still says there is no card, and offers Keep after the first run', () => {
    const card = deleteStepView(plain, viewer, { role: 'owner' }).shell.trial!;
    expect(card.note).toMatch(/^Then Free:/);
    expect(card.keep).toMatchObject({ href: '/api/billing/checkout' });
    expect(deleteStepView(plain, day0, { role: 'owner' }).shell.trial!.note).toMatch(
      /^No card on file\. When it ends/,
    );
  });
});

describe('a Checkout trial read by a member who is not the owner (ruling 5, walk shot 4-agency-30)', () => {
  // The owner cancels; a member cannot. CC-37 gives a non-owner "Managed by the account owner." for a
  // card on file, and a trial that charges an unrecorded card is the same card.
  for (const role of ['account_manager', 'developer'] as const) {
    it(`${role}: the rail says the owner manages it, not "unless you cancel"`, () => {
      for (const reader of [viewer, day0]) {
        const card = deleteStepView(checkoutTrial, reader, { role }).shell.trial!;
        expect(card.note).toBe('Managed by the account owner.');
        expect(card.keep).toBeNull();
        expect(card.billing).toBeNull();
      }
    });
  }

  it('the owner still reads the charge', () => {
    const card = deleteStepView(checkoutTrial, viewer, { role: 'owner' }).shell.trial!;
    expect(card.note).toBe('The card on file is charged on Sat 7 Nov unless you cancel.');
  });
});

describe('the same trial on Settings › Plan and Trial ending, by role (ruling 5 review)', () => {
  const accountId = viewer.accountId;
  const tev = (role: 'owner' | 'account_manager' | 'developer') =>
    trialEndView(checkoutTrial, trialEndViewer(checkoutTrial, accountId), { role });

  it('Settings › Plan: an account manager reads that the owner manages the card', () => {
    const v = settingsView(checkoutTrial, viewer, {
      role: 'account_manager',
      subscriptionStatus: 'trialing',
    });
    expect(v.plan.note).toBe('Ends Sat 7 Nov. Managed by the account owner.');
    expect(v.plan.note).not.toMatch(/unless you cancel/);
  });

  it('Settings › Plan: the owner still reads the charge', () => {
    const v = settingsView(checkoutTrial, viewer, {
      role: 'owner',
      subscriptionStatus: 'trialing',
    });
    expect(v.plan.note).toMatch(/The card on file is charged then unless you cancel\.$/);
  });

  it('Trial ending: the banner does not say no card is on file, for any role', () => {
    expect(tev('owner').banner.sub).not.toMatch(/No card is on file/);
    expect(tev('owner').banner.sub).toContain(
      'The card on file is charged on Sat 7 Nov unless you cancel.',
    );
    for (const role of ['account_manager', 'developer'] as const) {
      expect(tev(role).banner.sub).not.toMatch(/No card is on file|unless you cancel/);
      expect(tev(role).banner.sub).toContain('Managed by the account owner.');
      expect(tev(role).shell.trial!.note).toBe('Managed by the account owner.');
    }
  });

  it('the control: a trial with no card and no subscription still says no card is on file', () => {
    const v = trialEndView(plain, trialEndViewer(plain, accountId), { role: 'owner' });
    expect(v.banner.sub).toContain('No card is on file, so nothing is charged either way.');
  });
});
