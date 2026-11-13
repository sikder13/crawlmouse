import { describe, expect, it } from 'vitest';
import { AGENCY_MONTHLY, AGENCY_YEARLY } from '../../billing/prices';
import { parseCancel } from '../../billing/cancel';
import { portalRefusal } from '../../billing/portal-v2';
import { TRIAL_DAYS } from '../../billing/state-machine';
import {
  agencyStanding,
  agencyTrialView,
  chargeDate,
  type AgencyAccountRow,
  type AgencyStanding,
} from './agency-trial';
import { footerComing } from './agencies';
import { skipReason } from '../agency/schedules-run';

const NOW = new Date('2026-10-25T15:00:00Z');

const row = (over: Partial<AgencyAccountRow> = {}): AgencyAccountRow => ({
  id: 'a0000000-0000-4000-8000-00000000000b',
  role: 'owner',
  name: 'Summit Digital',
  state: 'free',
  tier: 'free',
  pastDueTier: null,
  pastDueSince: null,
  trialVariant: null,
  trialEndsAt: null,
  trialUsedAt: null,
  subscriptionId: null,
  billingEnd: null,
  firstSite: 'clientsite.com',
  ...over,
});

const NONE: AgencyStanding = { held: false, billing: [], used: null, open: null };
const USED = {
  accountId: 'a0000000-0000-4000-8000-00000000000b',
  trialUsedAt: new Date('2026-10-01T10:00:00Z'),
  deleted: false,
};
const view = (
  standing: AgencyStanding,
  interval: 'month' | 'year' = 'month',
  more: { customers?: Map<string, string | null>; cancelAsked?: string | null } = {},
) =>
  agencyTrialView(
    {
      email: 'me@agency.com',
      interval,
      timeZone: 'UTC',
      standing,
      customers: more.customers ?? new Map(),
      cancelAsked: more.cancelAsked ?? null,
    },
    NOW,
  );

describe('agencyStanding', () => {
  it('no agency account: nothing held, used or open', () => {
    expect(agencyStanding([], null, NOW)).toEqual(NONE);
  });

  it('an owned Free account with no trial and no subscription is the open Checkout (Q16)', () => {
    const r = row();
    expect(agencyStanding([r], null, NOW)).toEqual({
      held: false,
      billing: [],
      used: null,
      open: r,
    });
  });

  it('an owned account whose trial was used is used, and is not open', () => {
    const r = row({ trialUsedAt: new Date('2026-09-01T00:00:00Z') });
    expect(agencyStanding([r], USED, NOW)).toEqual({
      held: false,
      billing: [],
      used: USED,
      open: null,
    });
  });

  // N5: the used trial is the function's (readUsedAgencyTrial), a deleted account included, so the
  // page refuses what start_agency_trial_account refuses even when no live row shows it.
  it('a used trial on a deleted account is used, with no live account to show', () => {
    const deleted = { ...USED, deleted: true };
    expect(agencyStanding([], deleted, NOW)).toEqual({
      held: false,
      billing: [],
      used: deleted,
      open: null,
    });
    expect(view(agencyStanding([], deleted, NOW)).kind).toBe('used');
  });

  it.each([
    ['agency_trial', { state: 'agency_trial', tier: 'agency', trialVariant: 'card_required' }],
    ['agency', { state: 'agency', tier: 'agency' }],
    [
      'past due, in grace',
      {
        state: 'past_due',
        tier: 'agency',
        pastDueTier: 'agency',
        pastDueSince: new Date('2026-10-24T00:00:00Z'),
      },
    ],
  ] as const)('%s is held', (_n, over) => {
    expect(agencyStanding([row({ ...over, subscriptionId: 'sub_1' })], null, NOW).held).toBe(true);
  });

  it('past due beyond the grace is not held', () => {
    const r = row({
      state: 'past_due',
      tier: 'agency',
      pastDueTier: 'agency',
      pastDueSince: new Date('2026-10-01T00:00:00Z'),
      subscriptionId: 'sub_1',
      trialUsedAt: new Date('2026-09-01T00:00:00Z'),
    });
    expect(agencyStanding([r], USED, NOW)).toMatchObject({ held: false, used: USED, open: null });
  });

  it('a seat that does not own the account counts for held, never for open', () => {
    const member = row({ role: 'manager', trialUsedAt: new Date('2026-09-01T00:00:00Z') });
    expect(agencyStanding([member], null, NOW)).toEqual(NONE);
    expect(
      agencyStanding([row({ role: 'manager', state: 'agency', tier: 'agency' })], null, NOW).held,
    ).toBe(true);
  });

  it('an account with a subscription is not open', () => {
    expect(agencyStanding([row({ subscriptionId: 'sub_1' })], null, NOW).open).toBeNull();
  });
});

describe('agencyTrialView', () => {
  it('a new trialist gets the form, priced from prices.ts and dated from TRIAL_DAYS', () => {
    const v = view(NONE);
    expect(v.kind).toBe('form');
    if (v.kind !== 'form') return;
    expect(v.title).toBe('Start your Agency trial.');
    expect(v.lead.map((t) => t.text).join(' ')).toContain(
      `${TRIAL_DAYS} days, nothing charged. On day ${TRIAL_DAYS + 1} — Sun 8 Nov`,
    );
    expect(v.lead.map((t) => t.text).join(' ')).toContain(
      `charged $${AGENCY_MONTHLY} for the month`,
    );
    expect(v.returning).toBeNull();
    expect(v.defaults).toEqual({ agencyName: '', site: '' });
    expect(v.consent).toContain('renewing each month until I cancel');
    expect(v.consent).toContain('withdrawal period');
    expect(v.consent).toContain('Terms');
    expect(v.otherIntervalHref).toBe('/agency-trial?interval=year');
  });

  it('the aside says where a report goes while the trial runs, which is what the run does (Q47)', () => {
    for (const interval of ['month', 'year'] as const) {
      const v = view(NONE, interval);
      if (v.kind !== 'form') throw new Error('form expected');
      expect(v.aside.trialReports).toMatchObject({
        text: 'During the trial, reports go to your own address.',
        coming: false,
      });
      // It is said once, where the aside promises the reports.
      const page = JSON.stringify(v);
      expect(page.split(v.aside.trialReports.text)).toHaveLength(2);
      expect(v.aside.rows.some(([what]) => what.text.startsWith('Scheduled client reports'))).toBe(
        true,
      );
    }
    // And the rule the sentence states: in its Agency trial an account sends to the owner's own
    // address and to no other, whatever else would let the report through.
    const due = {
      account: {
        state: 'agency_trial' as const,
        tier: 'agency' as const,
        pastDueTier: null,
        pastDueSince: null,
        trialVariant: 'card_required' as const,
        trialEndsAt: new Date('2026-12-01T00:00:00Z'),
      },
      hasContact: true,
      confirmed: true,
      confirmationRequested: true,
      askRefused: false,
      checkId: 'c0000000-0000-4000-8000-000000000001',
      changed: true,
      sendWhenUnchanged: true,
      siteId: 's0000000-0000-4000-8000-000000000001',
      accountId: 'a0000000-0000-4000-8000-00000000000b',
      slot: NOW.toISOString(),
      contactIsOwner: true,
    };
    expect(skipReason(due, NOW)).toBeNull();
    expect(skipReason({ ...due, contactIsOwner: false }, NOW)).toBe('trial');
    // On the plan the same outside contact is sent to.
    expect(
      skipReason(
        { ...due, contactIsOwner: false, account: { ...due.account, state: 'agency' } },
        NOW,
      ),
    ).toBeNull();
  });

  it('the aside prices a seat beyond the plan by the month and by the year, on either form', () => {
    for (const interval of ['month', 'year'] as const) {
      const v = view(NONE, interval);
      if (v.kind !== 'form') throw new Error('form expected');
      const seats = v.aside.rows.map(([what]) => what.text).filter((t) => t.startsWith('Seats'));
      expect(seats).toEqual([
        'Seats · owner, account managers, developers · $12 a seat a month beyond, or $120 a year on a yearly plan',
      ]);
    }
  });

  it('yearly: the year’s price, and a link back to monthly', () => {
    const v = view(NONE, 'year');
    if (v.kind !== 'form') throw new Error('form expected');
    expect(v.lead.map((t) => t.text).join(' ')).toContain(`charged $${AGENCY_YEARLY} for the year`);
    expect(v.otherIntervalHref).toBe('/agency-trial');
  });

  it('a returning person is told the Checkout did not finish, with what they typed', () => {
    const v = view({ held: false, billing: [], used: null, open: row() });
    if (v.kind !== 'form') throw new Error('form expected');
    expect(v.returning).toMatch(/did not finish/);
    expect(v.defaults).toEqual({ agencyName: 'Summit Digital', site: 'clientsite.com' });
  });

  it('a used trial: the reason and no form', () => {
    expect(view({ held: false, billing: [], used: USED, open: null })).toEqual({
      kind: 'used',
      manage: [],
      footerComing: footerComing(),
      title: 'Your Agency trial was used.',
      text: 'The trial is one per person, and yours started Thu 1 Oct. Agency can still be chosen, from Pricing.',
    });
  });

  it('Agency held: no form', () => {
    expect(view({ held: true, billing: [], used: USED, open: null }).kind).toBe('held');
  });
});

describe('chargeDate', () => {
  it.each([
    ['2026-10-25T15:00:00Z', 'UTC', 'Sun 8 Nov'],
    ['2026-10-25T23:30:00Z', 'UTC', 'Sun 8 Nov'],
    ['2026-10-25T23:30:00Z', 'Asia/Tokyo', 'Mon 9 Nov'],
    ['2026-12-25T12:00:00Z', 'UTC', 'Fri 8 Jan'],
  ])('a trial started %s (%s) is charged %s', (at, zone, want) => {
    expect(chargeDate(new Date(at), zone)).toBe(want);
  });
});

// Q26 / correctness B1: Settings acts on the person's default account, so an owned agency account's
// billing and Cancel are on this page, each naming the account.
describe('an owned agency account’s billing', () => {
  const SUB = { subscriptionId: 'sub_1', trialUsedAt: new Date('2026-10-20T00:00:00Z') };
  const trialing = row({
    ...SUB,
    state: 'agency_trial',
    tier: 'agency',
    trialVariant: 'card_required',
    trialEndsAt: new Date('2026-11-03T15:00:00Z'),
  });

  it.each([
    ['agency_trial', trialing, true],
    ['agency', row({ ...SUB, state: 'agency', tier: 'agency' }), true],
    [
      'past_due',
      row({ ...SUB, state: 'past_due', tier: 'agency', pastDueTier: 'agency', pastDueSince: NOW }),
      true,
    ],
    ['free', row({ ...SUB, subscriptionId: null }), false],
    [
      'agency, a seat that is not the owner',
      row({ ...SUB, state: 'agency', tier: 'agency', role: 'account_manager' }),
      false,
    ],
  ] as const)('%s: offered here %s', (_n, r, offered) => {
    expect(agencyStanding([r], USED, NOW).billing).toEqual(offered ? [r] : []);
  });

  it('the trial: Manage billing and the first click of Cancel, both naming the account', () => {
    const v = view(agencyStanding([trialing], USED, NOW), 'year', {
      customers: new Map([[trialing.id, 'cus_1']]),
    });
    expect(v.kind).toBe('held');
    expect(v.manage).toEqual([
      {
        accountId: trialing.id,
        title: 'Summit Digital',
        text: 'On the Agency trial, which ends Tue 3 Nov. The card is charged when it ends unless you cancel.',
        portal: {
          method: 'post',
          action: '/api/billing/portal',
          fields: { accountId: trialing.id },
          label: 'Manage billing',
        },
        cancel: {
          ask: {
            method: 'get',
            action: '/agency-trial',
            fields: { cancel: trialing.id, interval: 'year' },
            label: 'Cancel the trial',
          },
          confirm: null,
        },
      },
    ]);
  });

  it('the second click posts confirm=true for that account, the body CC-03’s cancel parses', () => {
    const v = view(agencyStanding([trialing], USED, NOW), 'month', { cancelAsked: trialing.id });
    expect(v.manage[0]!.cancel!.confirm).toEqual({
      method: 'post',
      action: '/api/billing/cancel',
      fields: { accountId: trialing.id, confirm: 'true' },
      label: 'Yes, cancel',
      text: 'The trial runs to Tue 3 Nov and the card is not charged; the account then goes to Free. Nothing you can see is deleted.',
    });
    expect(parseCancel({ kind: 'form', fields: v.manage[0]!.cancel!.confirm!.fields })).toEqual({
      accountId: trialing.id,
      confirmed: true,
    });
    expect(
      view(agencyStanding([trialing], USED, NOW), 'month', { cancelAsked: 'other' }).manage[0]!
        .cancel!.confirm,
    ).toBeNull();
  });

  // Correctness B-r2-1: the cancel route sets cancel_at_period_end and the account stays on the
  // trial until it ends; the page reads that from the mirror (billingEnd) and says so, in Settings'
  // words (SETTINGS_COPY.trialCancelled, .cancelling), with no Cancel to click again.
  it('a trial set to cancel: not charged, in Settings’ words, and no Cancel, even when asked', () => {
    const cancelled = { ...trialing, billingEnd: new Date('2026-11-03T15:00:00Z') };
    const v = view(agencyStanding([cancelled], USED, NOW), 'month', {
      customers: new Map([[cancelled.id, 'cus_1']]),
      cancelAsked: cancelled.id,
    });
    expect(v.manage).toEqual([
      {
        accountId: cancelled.id,
        title: 'Summit Digital',
        text: 'Cancelled; the trial ends Tue 3 Nov and the card is not charged.',
        portal: {
          method: 'post',
          action: '/api/billing/portal',
          fields: { accountId: cancelled.id },
          label: 'Manage billing',
        },
        cancel: null,
      },
    ]);
    expect(JSON.stringify(v.manage)).not.toMatch(/charged when it ends|unless you cancel/);
  });

  it('Agency set to cancel: runs to the period’s end, nothing more charged, no Cancel', () => {
    const r = row({
      ...SUB,
      state: 'agency',
      tier: 'agency',
      billingEnd: new Date('2026-12-01T00:00:00Z'),
    });
    expect(view(agencyStanding([r], USED, NOW)).manage[0]).toMatchObject({
      text: 'Agency until Tue 1 Dec, then Free. Nothing more is charged.',
      cancel: null,
    });
  });

  it('past due and set to cancel: the payment that failed, and no Cancel', () => {
    const r = row({
      ...SUB,
      state: 'past_due',
      tier: 'agency',
      pastDueTier: 'agency',
      pastDueSince: NOW,
      billingEnd: new Date('2026-12-01T00:00:00Z'),
    });
    expect(view(agencyStanding([r], USED, NOW)).manage[0]).toMatchObject({
      text: 'The last payment failed. Update the card from Manage billing to keep Agency.',
      cancel: null,
    });
  });

  it('no Stripe customer: no Manage billing (portalRefusal); no subscription: no Cancel', () => {
    const noSub = row({ ...SUB, state: 'agency', tier: 'agency', subscriptionId: null });
    const v = view(agencyStanding([trialing, noSub], USED, NOW));
    expect(portalRefusal(null)).not.toBeNull();
    expect(v.manage.map((m) => [m.portal, m.cancel === null])).toEqual([
      [null, false],
      [null, true],
    ]);
  });
});
