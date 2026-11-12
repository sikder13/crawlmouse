import { describe, expect, it } from 'vitest';
import { FREE_START, trialRefusal, type EntitlementSnapshot } from '../../billing/state-machine';
import type { Tier } from '../../entitlement-v2';
import { pricingView, intervalFrom, type PricingViewer } from './pricing';

const NOW = new Date('2026-11-12T12:00:00Z');
const ACCOUNT = 'a0000000-0000-4000-8000-00000000000a';
const AGENCY = 'a0000000-0000-4000-8000-00000000000b';

const signedIn = (
  over: Partial<{ tier: Tier; owner: boolean; snapshot: EntitlementSnapshot }> = {},
  agency: { held: boolean; trialUsedAccountId: string | null } = {
    held: false,
    trialUsedAccountId: null,
  },
): PricingViewer => ({
  kind: 'signed_in',
  account: { id: ACCOUNT, owner: true, tier: 'free', snapshot: FREE_START, ...over },
  agency,
});

const action = (viewer: PricingViewer, tier: Tier, interval: 'month' | 'year' = 'month') =>
  pricingView(viewer, interval, NOW).plans.find((p) => p.tier === tier)!.action;

const primaries = (viewer: PricingViewer) =>
  pricingView(viewer, 'month', NOW).plans.filter(
    (p) => (p.action.kind === 'link' || p.action.kind === 'form') && p.action.primary,
  );

/** Snapshots the state machine refuses a trial for, each with the refusal it gives. */
const REFUSED: [string, EntitlementSnapshot][] = [
  ['trial used', { ...FREE_START, trialUsedAt: new Date('2026-10-01T00:00:00Z') }],
  ['disputed', { ...FREE_START, disputedAt: new Date('2026-10-01T00:00:00Z') }],
  ['subscription open', { ...FREE_START, subscriptionId: 'sub_123' }],
  ['a change after now', { ...FREE_START, lastChangeAt: new Date('2026-11-13T00:00:00Z') }],
];

describe('signed out', () => {
  const out: PricingViewer = { kind: 'signed_out' };

  it('Free and Pro go to Sign-up, Agency to the Agency trial page', () => {
    expect(action(out, 'free')).toMatchObject({ kind: 'link', href: '/signup' });
    expect(action(out, 'pro')).toMatchObject({
      kind: 'link',
      href: '/signup',
      label: 'Start with 14 days of Pro',
    });
    expect(action(out, 'agency')).toMatchObject({
      kind: 'link',
      href: '/agency-trial',
      label: 'Start a 14-day trial',
    });
  });

  it('the yearly choice carries to the Agency trial page', () => {
    expect(action(out, 'agency', 'year')).toMatchObject({ href: '/agency-trial?interval=year' });
  });

  it('the Pro button is the one orange element', () => {
    expect(primaries(out).map((p) => p.tier)).toEqual(['pro']);
  });
});

describe('signed in: the Pro button follows the state machine', () => {
  it('a Free account the machine lets start a trial is offered the trial', () => {
    expect(trialRefusal(FREE_START, NOW)).toBeNull();
    expect(action(signedIn(), 'pro')).toEqual({
      kind: 'form',
      action: '/api/billing/pro-trial/start',
      fields: { accountId: ACCOUNT },
      label: 'Start with 14 days of Pro',
      note: 'Same account; $19 a month only if you keep Pro',
      primary: true,
    });
  });

  it.each(REFUSED)('%s: no trial button, the paid checkout instead', (_why, snapshot) => {
    expect(trialRefusal(snapshot, NOW)).not.toBeNull();
    const a = action(signedIn({ snapshot }), 'pro', 'year');
    expect(a).toMatchObject({
      kind: 'form',
      action: '/api/billing/checkout',
      fields: { plan: 'pro', interval: 'year', accountId: ACCOUNT },
      label: 'Choose Pro',
    });
  });

  it('every generated refused snapshot gets the checkout, never the trial', () => {
    // Vary each field trialRefusal reads, alone and together.
    const variants: Partial<EntitlementSnapshot>[] = [];
    for (const trialUsedAt of [null, NOW])
      for (const disputedAt of [null, NOW])
        for (const subscriptionId of [null, 'sub_1'])
          for (const lastChangeAt of [null, new Date(NOW.getTime() + 60_000)])
            variants.push({ trialUsedAt, disputedAt, subscriptionId, lastChangeAt });
    for (const v of variants) {
      const snapshot = { ...FREE_START, ...v };
      const offered = (action(signedIn({ snapshot }), 'pro') as { action?: string }).action;
      expect(offered === '/api/billing/pro-trial/start', JSON.stringify(v)).toBe(
        trialRefusal(snapshot, NOW) === null,
      );
    }
  });

  it('the account on Pro sees "Your plan"; on Agency, Pro is included', () => {
    expect(action(signedIn({ tier: 'pro' }), 'pro')).toMatchObject({
      kind: 'current',
      label: 'Your plan',
    });
    expect(action(signedIn({ tier: 'agency' }), 'pro')).toMatchObject({
      kind: 'current',
      label: 'Included in your plan',
    });
  });

  it('a seat that is not the owner is told who changes the plan', () => {
    expect(action(signedIn({ owner: false }), 'pro')).toEqual({
      kind: 'note',
      note: 'Only the account owner changes its plan',
    });
  });

  it('Free is "Your plan" on Free and a note on a paid tier', () => {
    expect(action(signedIn(), 'free')).toMatchObject({ kind: 'current', label: 'Your plan' });
    expect(action(signedIn({ tier: 'pro' }), 'free')).toMatchObject({ kind: 'note' });
  });
});

describe('signed in: the Agency button reads the agency accounts', () => {
  it('no agency account: the trial', () => {
    expect(action(signedIn(), 'agency')).toMatchObject({ kind: 'link', href: '/agency-trial' });
  });

  it('an agency account on Agency: "Your plan"', () => {
    expect(
      action(signedIn({}, { held: true, trialUsedAccountId: AGENCY }), 'agency'),
    ).toMatchObject({ kind: 'current', label: 'Your plan' });
  });

  it('the default account on Agency: "Your plan"', () => {
    expect(action(signedIn({ tier: 'agency' }), 'agency')).toMatchObject({ kind: 'current' });
  });

  it('an agency trial used: the paid checkout on that account, no second trial', () => {
    expect(
      action(signedIn({}, { held: false, trialUsedAccountId: AGENCY }), 'agency', 'year'),
    ).toEqual({
      kind: 'form',
      action: '/api/billing/checkout',
      fields: { plan: 'agency', interval: 'year', accountId: AGENCY },
      label: 'Choose Agency',
      note: '$990 a year; your agency has used its trial',
      primary: false,
    });
  });
});

describe('one orange element', () => {
  const viewers: [string, PricingViewer][] = [
    ['signed out', { kind: 'signed_out' }],
    ['free, trial open', signedIn()],
    ['free, trial used', signedIn({ snapshot: REFUSED[0]![1] })],
    ['pro', signedIn({ tier: 'pro' })],
    ['agency', signedIn({ tier: 'agency' })],
    ['pro, agency held', signedIn({ tier: 'pro' }, { held: true, trialUsedAccountId: null })],
    ['not owner', signedIn({ owner: false })],
    [
      'no default account',
      { kind: 'signed_in', account: null, agency: { held: false, trialUsedAccountId: null } },
    ],
  ];

  it.each(viewers)('%s: at most one, and one whenever a button exists', (_n, viewer) => {
    const buttons = pricingView(viewer, 'month', NOW).plans.filter(
      (p) => p.action.kind === 'link' || p.action.kind === 'form',
    );
    expect(primaries(viewer).length).toBe(buttons.length > 0 ? 1 : 0);
  });
});

describe('the interval', () => {
  it('prices each plan on the chosen interval', () => {
    const month = pricingView({ kind: 'signed_out' }, 'month', NOW).plans;
    const year = pricingView({ kind: 'signed_out' }, 'year', NOW).plans;
    expect(month.map((p) => `${p.price} ${p.per}`)).toEqual([
      '$0 a month',
      '$19 a month',
      '$99 a month',
    ]);
    expect(year.map((p) => `${p.price} ${p.per}`)).toEqual([
      '$0 a year',
      '$190 a year',
      '$990 a year',
    ]);
  });

  it('marks the chosen interval and links the other', () => {
    const v = pricingView({ kind: 'signed_out' }, 'year', NOW);
    expect(v.intervals).toEqual([
      { interval: 'month', label: 'Monthly', href: '/pricing', current: false },
      { interval: 'year', label: 'Yearly', href: '/pricing?interval=year', current: true },
    ]);
  });

  it.each([
    [undefined, 'month'],
    ['year', 'year'],
    ['month', 'month'],
    ['YEAR', 'month'],
    [['year'], 'month'],
  ] as const)('?interval=%j reads as %s', (raw, want) => {
    expect(intervalFrom(raw as string | string[] | undefined)).toBe(want);
  });
});
