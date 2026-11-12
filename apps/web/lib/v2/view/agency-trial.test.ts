import { describe, expect, it } from 'vitest';
import { AGENCY_MONTHLY, AGENCY_YEARLY } from '../../billing/prices';
import { TRIAL_DAYS } from '../../billing/state-machine';
import {
  agencyStanding,
  agencyTrialView,
  chargeDate,
  type AgencyAccountRow,
  type AgencyStanding,
} from './agency-trial';

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
  firstSite: 'clientsite.com',
  ...over,
});

const NONE: AgencyStanding = { held: false, used: null, open: null };
const view = (standing: AgencyStanding, interval: 'month' | 'year' = 'month') =>
  agencyTrialView({ email: 'me@agency.com', interval, timeZone: 'UTC', standing }, NOW);

describe('agencyStanding', () => {
  it('no agency account: nothing held, used or open', () => {
    expect(agencyStanding([], NOW)).toEqual(NONE);
  });

  it('an owned Free account with no trial and no subscription is the open Checkout (Q16)', () => {
    const r = row();
    expect(agencyStanding([r], NOW)).toEqual({ held: false, used: null, open: r });
  });

  it('an owned account whose trial was used is used, and is not open', () => {
    const r = row({ trialUsedAt: new Date('2026-09-01T00:00:00Z') });
    expect(agencyStanding([r], NOW)).toEqual({ held: false, used: r, open: null });
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
    expect(agencyStanding([row({ ...over, subscriptionId: 'sub_1' })], NOW).held).toBe(true);
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
    expect(agencyStanding([r], NOW)).toMatchObject({ held: false, used: r, open: null });
  });

  it('a seat that does not own the account counts for held, never for used or open', () => {
    const member = row({ role: 'manager', trialUsedAt: new Date('2026-09-01T00:00:00Z') });
    expect(agencyStanding([member], NOW)).toEqual(NONE);
    expect(
      agencyStanding([row({ role: 'manager', state: 'agency', tier: 'agency' })], NOW).held,
    ).toBe(true);
  });

  it('an account with a subscription is not open', () => {
    expect(agencyStanding([row({ subscriptionId: 'sub_1' })], NOW).open).toBeNull();
  });
});

describe('agencyTrialView', () => {
  it('a new trialist gets the form, priced from prices.ts and dated from TRIAL_DAYS', () => {
    const v = view(NONE);
    expect(v.kind).toBe('form');
    if (v.kind !== 'form') return;
    expect(v.title).toBe('Start your Agency trial.');
    expect(v.lead).toContain(
      `${TRIAL_DAYS} days, nothing charged. On day ${TRIAL_DAYS + 1} — Sun 8 Nov`,
    );
    expect(v.lead).toContain(`charged $${AGENCY_MONTHLY} for the month`);
    expect(v.returning).toBeNull();
    expect(v.defaults).toEqual({ agencyName: '', site: '' });
    expect(v.consent).toContain('renewing each month until I cancel');
    expect(v.consent).toContain('withdrawal period');
    expect(v.consent).toContain('Terms');
    expect(v.otherIntervalHref).toBe('/agency-trial?interval=year');
  });

  it('yearly: the year’s price, and a link back to monthly', () => {
    const v = view(NONE, 'year');
    if (v.kind !== 'form') throw new Error('form expected');
    expect(v.lead).toContain(`charged $${AGENCY_YEARLY} for the year`);
    expect(v.otherIntervalHref).toBe('/agency-trial');
  });

  it('a returning person is told the Checkout did not finish, with what they typed', () => {
    const v = view({ held: false, used: null, open: row() });
    if (v.kind !== 'form') throw new Error('form expected');
    expect(v.returning).toMatch(/did not finish/);
    expect(v.defaults).toEqual({ agencyName: 'Summit Digital', site: 'clientsite.com' });
  });

  it('a used trial: the reason and no form', () => {
    const used = row({ trialUsedAt: new Date('2026-10-01T10:00:00Z') });
    expect(view({ held: false, used, open: null })).toEqual({
      kind: 'used',
      title: 'Your Agency trial was used.',
      text: 'The trial is one per person, and yours started Thu 1 Oct. Agency can still be chosen, from Pricing.',
    });
  });

  it('Agency held: no form', () => {
    expect(view({ held: true, used: row(), open: null }).kind).toBe('held');
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
