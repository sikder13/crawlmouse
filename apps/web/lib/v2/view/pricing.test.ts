import { AccountStateSchema } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { checkoutRefusal } from '../../billing/checkout-refusal';
import { portalRefusal } from '../../billing/portal-v2';
import { FREE_START, trialRefusal, type EntitlementSnapshot } from '../../billing/state-machine';
import type { Tier } from '../../entitlement-v2';
import {
  pricingView,
  intervalFrom,
  type PlanAction,
  type PricingAccount,
  type PricingFlags,
  type PricingViewer,
} from './pricing';

const NOW = new Date('2026-11-12T12:00:00Z');
const ACCOUNT = 'a0000000-0000-4000-8000-00000000000a';
const AGENCY = 'a0000000-0000-4000-8000-00000000000b';
const ON: PricingFlags = { accountDoor: true, checksPublic: true };
const FLAGS: PricingFlags[] = [
  ON,
  { accountDoor: false, checksPublic: true },
  { accountDoor: true, checksPublic: false },
  { accountDoor: false, checksPublic: false },
];

type Agency = Extract<PricingViewer, { kind: 'signed_in' }>['agency'];
const NO_AGENCY: Agency = { held: false, used: null };

const signedIn = (
  over: Partial<{
    tier: Tier;
    owner: boolean;
    snapshot: EntitlementSnapshot;
    customer: string | null;
  }> = {},
  agency: Agency = NO_AGENCY,
): PricingViewer => ({
  kind: 'signed_in',
  account: {
    id: ACCOUNT,
    owner: true,
    tier: 'free',
    snapshot: FREE_START,
    customer: null,
    ...over,
  },
  agency,
});

const usedOn = (snapshot: EntitlementSnapshot, customer: string | null = null): Agency => ({
  held: false,
  used: { account: { id: AGENCY, snapshot, customer } },
});

const action = (
  viewer: PricingViewer,
  tier: Tier,
  interval: 'month' | 'year' = 'month',
  flags: PricingFlags = ON,
) => pricingView(viewer, interval, NOW, flags).plans.find((p) => p.tier === tier)!.action;

const primaries = (viewer: PricingViewer, flags: PricingFlags = ON) =>
  pricingView(viewer, 'month', NOW, flags).plans.filter(
    (p) => (p.action.kind === 'link' || p.action.kind === 'form') && p.action.primary,
  );

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

  // Q24/Q31: Sign-up is a 404 without V2_ACCOUNT_DOOR; v1 sends people to its sign-in, which creates
  // the account and starts no trial. Signed in, this page then offers the Pro trial only while
  // V2_CHECKS_PUBLIC serves its route, so Pro's note says which (SEO R2-N1).
  it('with V2_ACCOUNT_DOOR off, Free and Pro go to v1’s sign-in, and no trial is promised there', () => {
    const off = { accountDoor: false, checksPublic: false };
    expect(action(out, 'free', 'month', off)).toEqual({
      kind: 'link',
      href: '/login',
      label: 'Create a free account',
      note: 'One email, no card',
      primary: false,
    });
    expect(action(out, 'pro', 'year', off)).toEqual({
      kind: 'link',
      href: '/login',
      label: 'Choose Pro',
      note: 'Sign in first; $190 a year, the card taken by Stripe',
      primary: true,
    });
  });

  it('with V2_ACCOUNT_DOOR off and V2_CHECKS_PUBLIC on, Pro signs in and comes back to the trial', () => {
    const off = { accountDoor: false, checksPublic: true };
    expect(action(out, 'pro', 'year', off)).toEqual({
      kind: 'link',
      href: '/login?next=%2Fpricing%3Finterval%3Dyear',
      label: 'Start with 14 days of Pro',
      note: 'Sign in first; then 14 days of Pro, no card',
      primary: true,
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

  it('with V2_CHECKS_PUBLIC off, the trial’s route is a 404: the paid checkout instead', () => {
    expect(action(signedIn(), 'pro', 'month', { accountDoor: true, checksPublic: false })).toEqual({
      kind: 'form',
      action: '/api/billing/checkout',
      fields: { plan: 'pro', interval: 'month', accountId: ACCOUNT },
      label: 'Choose Pro',
      note: '$19 a month; the card is taken by Stripe',
      primary: true,
    });
  });

  it('a used trial: the paid checkout', () => {
    const snapshot = { ...FREE_START, trialUsedAt: new Date('2026-10-01T00:00:00Z') };
    expect(action(signedIn({ snapshot }), 'pro', 'year')).toMatchObject({
      kind: 'form',
      action: '/api/billing/checkout',
      fields: { plan: 'pro', interval: 'year', accountId: ACCOUNT },
      label: 'Choose Pro',
    });
  });

  // Correctness B2: CC-03 answers subscription_open to a checkout on an account that still follows
  // a subscription (Free after a lapse, past due beyond the grace); that account's portal is offered.
  it.each([
    ['free after a lapse, the subscription kept', { ...FREE_START, subscriptionId: 'sub_1' }],
    [
      'past due beyond the grace',
      {
        ...FREE_START,
        state: 'past_due' as const,
        tier: 'pro' as const,
        pastDueTier: 'pro' as const,
        pastDueSince: new Date('2026-10-01T00:00:00Z'),
        subscriptionId: 'sub_1',
      },
    ],
  ])('%s: the billing portal, not the checkout CC-03 refuses', (_, snapshot) => {
    expect(checkoutRefusal(snapshot, 'pro')).toMatchObject({ error: 'subscription_open' });
    expect(action(signedIn({ snapshot, customer: 'cus_1' }), 'pro')).toEqual({
      kind: 'form',
      action: '/api/billing/portal',
      fields: { accountId: ACCOUNT },
      label: 'Manage billing',
      note: 'This account still has a subscription; change it from the billing page',
      primary: true,
    });
    expect(action(signedIn({ snapshot, customer: null }), 'pro')).toEqual({
      kind: 'note',
      note: 'This account cannot choose this plan now',
    });
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
    expect(action(signedIn({}, { ...usedOn(FREE_START), held: true }), 'agency')).toMatchObject({
      kind: 'current',
      label: 'Your plan',
    });
  });

  it('the default account on Agency: "Your plan"', () => {
    expect(action(signedIn({ tier: 'agency' }), 'agency')).toMatchObject({ kind: 'current' });
  });

  it('an agency trial used: the paid checkout on that account, no second trial', () => {
    const snapshot = { ...FREE_START, trialUsedAt: new Date('2026-10-01T00:00:00Z') };
    expect(action(signedIn({}, usedOn(snapshot)), 'agency', 'year')).toEqual({
      kind: 'form',
      action: '/api/billing/checkout',
      fields: { plan: 'agency', interval: 'year', accountId: AGENCY },
      label: 'Choose Agency',
      note: '$990 a year; your agency has used its trial',
      primary: false,
    });
  });

  it('a lapsed agency account that keeps its subscription: that account’s portal', () => {
    const snapshot = { ...FREE_START, trialUsedAt: NOW, subscriptionId: 'sub_9' };
    expect(action(signedIn({}, usedOn(snapshot, 'cus_9')), 'agency')).toMatchObject({
      kind: 'form',
      action: '/api/billing/portal',
      fields: { accountId: AGENCY },
    });
  });

  it('a used trial on a deleted agency account: no button, and no second trial', () => {
    expect(action(signedIn({}, { held: false, used: { account: null } }), 'agency')).toEqual({
      kind: 'note',
      note: 'Your agency trial was used, on an agency account since deleted',
    });
  });
});

/**
 * Correctness B2's sweep: every snapshot the refusals can tell apart, generated over each field
 * they read, alone and together, for the default account and the used agency account, under each
 * flag pair. Whatever a plan offers, the offered route's own refusal function answers null for the
 * account the form names; and where it offers no paid button, the routes would refuse.
 */
describe('every offered route accepts the account it names', () => {
  const snapshots: EntitlementSnapshot[] = [];
  for (const state of AccountStateSchema.options)
    for (const trialUsedAt of [null, NOW])
      for (const disputedAt of [null, NOW])
        for (const subscriptionId of [null, 'sub_1'])
          for (const lastChangeAt of [null, new Date(NOW.getTime() + 60_000)])
            snapshots.push({
              ...FREE_START,
              state,
              trialUsedAt,
              disputedAt,
              subscriptionId,
              lastChangeAt,
            });

  const viewers: { viewer: PricingViewer; accounts: Map<string, PricingAccount> }[] = [];
  for (const snapshot of snapshots)
    for (const customer of [null, 'cus_1']) {
      const own = { id: ACCOUNT, snapshot, customer };
      for (const tier of ['free', 'pro', 'agency'] as const)
        for (const owner of [true, false])
          viewers.push({
            viewer: { kind: 'signed_in', account: { ...own, owner, tier }, agency: NO_AGENCY },
            accounts: new Map([[ACCOUNT, own]]),
          });
      const agency = { id: AGENCY, snapshot, customer };
      viewers.push({
        viewer: {
          kind: 'signed_in',
          account: null,
          agency: { held: false, used: { account: agency } },
        },
        accounts: new Map([[AGENCY, agency]]),
      });
    }

  /** The refusal of the route an action reaches, for the account it names; null when it accepts. */
  function refusalOf(
    a: Extract<PlanAction, { kind: 'form' }>,
    accounts: Map<string, PricingAccount>,
  ) {
    const account = accounts.get(a.fields.accountId!);
    if (account === undefined)
      return `names an account the viewer does not hold: ${a.fields.accountId}`;
    switch (a.action) {
      case '/api/billing/pro-trial/start':
        return trialRefusal(account.snapshot, NOW);
      case '/api/billing/checkout':
        return checkoutRefusal(account.snapshot, a.fields.plan as 'pro' | 'agency');
      case '/api/billing/portal':
        return portalRefusal(account.customer);
      default:
        return `a route with no refusal function here: ${a.action}`;
    }
  }

  it('generates every state and both answers of each refusal', () => {
    expect(viewers.length).toBeGreaterThan(1000);
    const seen = new Set(
      viewers.flatMap(({ accounts }) =>
        [...accounts.values()].map((a) => checkoutRefusal(a.snapshot, 'pro')?.error ?? 'none'),
      ),
    );
    expect([...seen].sort()).toEqual(['none', 'plan_held', 'subscription_open']);
  });

  it.each(FLAGS)('flags %j: each form names an account its route accepts', (flags) => {
    const offered = new Map<string, number>();
    for (const { viewer, accounts } of viewers) {
      for (const plan of pricingView(viewer, 'month', NOW, flags).plans) {
        const a = plan.action;
        if (a.kind !== 'form') continue;
        offered.set(a.action, (offered.get(a.action) ?? 0) + 1);
        expect(refusalOf(a, accounts), `${plan.tier} ${JSON.stringify(viewer)}`).toBeNull();
        if (a.action === '/api/billing/pro-trial/start') expect(flags.checksPublic).toBe(true);
      }
    }
    // Each route is offered somewhere in the sweep, so the assertion above is not vacuous.
    expect([...offered.keys()].sort()).toEqual(
      [
        '/api/billing/checkout',
        '/api/billing/portal',
        ...(flags.checksPublic ? ['/api/billing/pro-trial/start'] : []),
      ].sort(),
    );
  });

  it('a paid plan shows no button only when the checkout and the portal would both refuse', () => {
    for (const { viewer, accounts } of viewers) {
      for (const plan of pricingView(viewer, 'month', NOW, ON).plans) {
        if (plan.tier === 'free' || plan.action.kind !== 'note') continue;
        if (plan.action.note !== 'This account cannot choose this plan now') continue;
        const target = plan.tier === 'pro' ? accounts.get(ACCOUNT) : accounts.get(AGENCY);
        expect(checkoutRefusal(target!.snapshot, plan.tier)).not.toBeNull();
        expect(
          checkoutRefusal(target!.snapshot, plan.tier)!.error === 'subscription_open' &&
            portalRefusal(target!.customer) === null,
        ).toBe(false);
      }
    }
  });
});

describe('one orange element', () => {
  const viewers: [string, PricingViewer][] = [
    ['signed out', { kind: 'signed_out' }],
    ['free, trial open', signedIn()],
    ['free, trial used', signedIn({ snapshot: { ...FREE_START, trialUsedAt: NOW } })],
    ['pro', signedIn({ tier: 'pro' })],
    ['agency', signedIn({ tier: 'agency' })],
    ['pro, agency held', signedIn({ tier: 'pro' }, { held: true, used: null })],
    ['not owner', signedIn({ owner: false })],
    ['no default account', { kind: 'signed_in', account: null, agency: NO_AGENCY }],
  ];

  it.each(viewers)('%s: at most one, and one whenever a button exists', (_n, viewer) => {
    for (const flags of FLAGS) {
      const buttons = pricingView(viewer, 'month', NOW, flags).plans.filter(
        (p) => p.action.kind === 'link' || p.action.kind === 'form',
      );
      expect(primaries(viewer, flags).length).toBe(buttons.length > 0 ? 1 : 0);
    }
  });
});

describe('the interval', () => {
  it('prices each plan on the chosen interval', () => {
    const month = pricingView({ kind: 'signed_out' }, 'month', NOW, ON).plans;
    const year = pricingView({ kind: 'signed_out' }, 'year', NOW, ON).plans;
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
    const v = pricingView({ kind: 'signed_out' }, 'year', NOW, ON);
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
