/**
 * F-251: with billing open to everyone and Agency sales closed (V2_AGENCY_SALES off), the checkout
 * refuses Agency and `/agency-trial` redirects, so `/pricing` must not sell it either. Agency reads
 * as it does with billing off; Pro is sold as normal.
 */
import { describe, expect, it } from 'vitest';
import { AGENCY_YEARLY, usd } from '../../billing/prices';
import { FREE_START } from '../../billing/state-machine';
import { pricingView, type PlanAction, type PricingFlags, type PricingViewer } from './pricing';

const NOW = new Date('2026-11-22T12:00:00Z');
const CLOSED: PricingFlags = {
  accountDoor: true,
  checksPublic: true,
  billing: true,
  agencySales: false,
};
const OPEN: PricingFlags = { ...CLOSED, agencySales: true };
const OFF: PricingFlags = { ...CLOSED, billing: false };

const account = (tier: 'free' | 'pro' | 'agency', owner = true) => ({
  id: 'acct-1',
  owner,
  tier,
  snapshot: FREE_START,
  customer: 'cus_1',
});

const SIGNED_OUT: PricingViewer = { kind: 'signed_out' };
/** Signed in, the Pro trial used: with billing on, Pro's button is the paid checkout. */
const PRO_TRIAL_USED: PricingViewer = {
  kind: 'signed_in',
  account: { ...account('free'), snapshot: { ...FREE_START, trialUsedAt: NOW } },
  agency: { held: false, used: null },
};
const VIEWERS: [string, PricingViewer][] = [
  ['signed out', SIGNED_OUT],
  [
    'signed in, no account',
    { kind: 'signed_in', account: null, agency: { held: false, used: null } },
  ],
  [
    'signed in, free owner',
    { kind: 'signed_in', account: account('free'), agency: { held: false, used: null } },
  ],
  [
    'signed in, not the owner',
    { kind: 'signed_in', account: account('free', false), agency: { held: false, used: null } },
  ],
  [
    'signed in, on Pro',
    { kind: 'signed_in', account: account('pro'), agency: { held: false, used: null } },
  ],
  [
    'signed in, agency trial used on a live account',
    {
      kind: 'signed_in',
      account: account('free'),
      agency: {
        held: false,
        used: { account: { id: 'a2', snapshot: FREE_START, customer: null } },
      },
    },
  ],
  [
    'signed in, agency trial used on a deleted account',
    {
      kind: 'signed_in',
      account: account('free'),
      agency: { held: false, used: { account: null } },
    },
  ],
  ['signed in, Pro trial used', PRO_TRIAL_USED],
];
const INTERVALS = ['month', 'year'] as const;

const sellsAgency = (a: PlanAction): boolean =>
  (a.kind === 'link' && /agency-trial/.test(a.href)) ||
  (a.kind === 'form' && (a.fields.plan === 'agency' || /agency-trial/.test(a.action)));

const taggedText = (t: { text: string }) => t.text;
const allText = (v: ReturnType<typeof pricingView>) =>
  [
    taggedText(v.title),
    ...v.lead.map(taggedText),
    ...v.crawlers.map(taggedText),
    ...v.annual.map(taggedText),
    v.after.title,
    ...v.after.lead.map(taggedText),
    ...v.after.rows.flatMap(([what, t]) => [what, t.text]),
    ...v.why.text.map(taggedText),
    ...v.faq.items.flatMap((i) => [i.q, i.a.text]),
    ...v.plans.flatMap((p) => [
      p.tag,
      p.description.text,
      ...p.rows.map(taggedText),
      p.action.note,
      ...(p.action.kind === 'note' ? [] : [p.action.label]),
    ]),
  ].join(' ');

/** Every capability the view's tagged sentences carry, the plan columns' included. */
const capabilitiesOf = (v: ReturnType<typeof pricingView>): string[] =>
  [
    v.title,
    ...v.lead,
    ...v.crawlers,
    ...v.annual,
    ...v.after.lead,
    ...v.after.rows.map(([, t]) => t),
    ...v.why.text,
    ...v.faq.items.map((i) => i.a),
    ...v.plans.flatMap((p) => [p.description, ...p.rows]),
  ].flatMap((t) => (t as { capabilities?: readonly string[] }).capabilities ?? []);

const agencyOf = (v: ReturnType<typeof pricingView>) => v.plans.find((p) => p.tier === 'agency')!;
const proOf = (v: ReturnType<typeof pricingView>) => v.plans.find((p) => p.tier === 'pro')!;

describe('pricingView with billing on and Agency sales closed (F-251)', () => {
  describe.each(INTERVALS)('%s', (interval) => {
    it.each(VIEWERS)(
      '%s: no button reaches the Agency trial or an Agency checkout',
      (_n, viewer) => {
        const view = pricingView(viewer, interval, NOW, CLOSED);
        expect(view.plans.filter((p) => sellsAgency(p.action)).map((p) => p.tier)).toEqual([]);
      },
    );

    it.each(VIEWERS)('%s: Agency’s tag reads as with billing off, with no card', (_n, viewer) => {
      const agency = agencyOf(pricingView(viewer, interval, NOW, CLOSED));
      expect(agency.tag).not.toMatch(/card/i);
      expect(agency.tag).toBe(agencyOf(pricingView(viewer, interval, NOW, OFF)).tag);
    });

    it.each(VIEWERS)(
      '%s: no sentence sells the Agency trial or charges for Agency',
      (_n, viewer) => {
        const text = allText(pricingView(viewer, interval, NOW, CLOSED));
        expect(text).not.toMatch(/agency(?:’s|'s)? trial|card on file|\bcharged\b/i);
        expect(text).not.toMatch(
          new RegExp(
            `Agency ${usd(AGENCY_YEARLY).replace('$', '\\$')} — \\w+ months free, from Settings`,
          ),
        );
      },
    );

    it.each(VIEWERS)('%s: no sentence is marked as the Agency trial', (_n, viewer) => {
      expect(capabilitiesOf(pricingView(viewer, interval, NOW, CLOSED))).not.toContain(
        'agency_trial',
      );
    });
  });

  it('a signed-out visitor is offered Agency as with billing off: start free, opening shortly', () => {
    for (const interval of INTERVALS) {
      const closed = agencyOf(pricingView(SIGNED_OUT, interval, NOW, CLOSED));
      const off = agencyOf(pricingView(SIGNED_OUT, interval, NOW, OFF));
      expect(closed.action).toMatchObject({ kind: 'link', href: '/signup', label: 'Start free' });
      expect(closed.action).toEqual(off.action);
    }
  });

  it('a signed-in viewer is told the Agency plan opens shortly, not that paid plans do', () => {
    const viewer = VIEWERS[2]![1];
    const action = agencyOf(pricingView(viewer, 'month', NOW, CLOSED)).action;
    expect(action).toEqual({ kind: 'note', note: 'The Agency plan opens shortly' });
  });

  it('Pro still sells: the trial signed out, the checkout once the trial is used', () => {
    for (const interval of INTERVALS) {
      expect(proOf(pricingView(SIGNED_OUT, interval, NOW, CLOSED)).action).toMatchObject({
        kind: 'link',
        href: '/signup',
      });
      expect(proOf(pricingView(PRO_TRIAL_USED, interval, NOW, CLOSED)).action).toMatchObject({
        kind: 'form',
        action: '/api/billing/checkout',
        fields: { plan: 'pro', interval },
      });
      expect(proOf(pricingView(PRO_TRIAL_USED, interval, NOW, CLOSED)).tag).toBe('card required');
    }
  });

  it('with both open, the Agency trial and its promises are offered', () => {
    const view = pricingView(SIGNED_OUT, 'month', NOW, OPEN);
    expect(sellsAgency(agencyOf(view).action)).toBe(true);
    expect(agencyOf(view).tag).toMatch(/card required/);
    expect(allText(pricingView(PRO_TRIAL_USED, 'month', NOW, OPEN))).toMatch(/card on file/i);
  });

  it('with billing off, Agency sales change nothing', () => {
    for (const [, viewer] of VIEWERS) {
      for (const interval of INTERVALS) {
        expect(pricingView(viewer, interval, NOW, { ...OFF, agencySales: true })).toEqual(
          pricingView(viewer, interval, NOW, OFF),
        );
      }
    }
  });
});
