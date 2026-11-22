/**
 * RC-01: `/pricing` is served with V2_BILLING off, so no button on it may reach a route that takes a
 * card or answers 404 while billing is off, and no sentence may promise what only runs with it on.
 */
import { describe, expect, it } from 'vitest';
import { FREE_START } from '../../billing/state-machine';
import { pricingView, type PlanAction, type PricingViewer } from './pricing';

const NOW = new Date('2026-11-22T12:00:00Z');
const OFF = { accountDoor: true, checksPublic: true, billing: false };
const ON = { ...OFF, billing: true };

const account = (tier: 'free' | 'pro' | 'agency', owner = true) => ({
  id: 'acct-1',
  owner,
  tier,
  snapshot: FREE_START,
  customer: 'cus_1',
});

const VIEWERS: PricingViewer[] = [
  { kind: 'signed_out' },
  { kind: 'signed_in', account: null, agency: { held: false, used: null } },
  { kind: 'signed_in', account: account('free'), agency: { held: false, used: null } },
  { kind: 'signed_in', account: account('free', false), agency: { held: false, used: null } },
  { kind: 'signed_in', account: account('pro'), agency: { held: false, used: null } },
  {
    kind: 'signed_in',
    account: account('free'),
    agency: { held: false, used: { account: { id: 'a2', snapshot: FREE_START, customer: null } } },
  },
  { kind: 'signed_in', account: account('agency'), agency: { held: true, used: null } },
  // The Pro trial is used, so with billing on Pro's button is the paid checkout.
  {
    kind: 'signed_in',
    account: { ...account('free'), snapshot: { ...FREE_START, trialUsedAt: NOW } },
    agency: { held: false, used: null },
  },
];

const targets = (a: PlanAction): string[] =>
  a.kind === 'link' ? [a.href] : a.kind === 'form' ? [a.action] : [];

const allText = (v: ReturnType<typeof pricingView>) =>
  [
    ...v.after.lead.map((t) => t.text),
    ...v.after.rows.map(([, t]) => t.text),
    ...v.faq.items.map((i) => i.a.text),
    ...v.annual.map((t) => t.text),
    ...v.plans.flatMap((p) => [
      p.tag,
      p.action.note,
      ...(p.action.kind === 'note' ? [] : [p.action.label]),
    ]),
  ].join(' ');

describe('pricingView with billing off (RC-01)', () => {
  it.each(VIEWERS.map((v, i) => [i, v] as const))(
    'viewer %i: no button reaches checkout, the portal or the agency trial',
    (_i, viewer) => {
      for (const interval of ['month', 'year'] as const) {
        const reached = pricingView(viewer, interval, NOW, OFF).plans.flatMap((p) =>
          targets(p.action),
        );
        expect(reached.filter((t) => /billing\/(checkout|portal)|agency-trial/.test(t))).toEqual(
          [],
        );
      }
    },
  );

  it('a signed-out visitor is offered Agency as opening shortly, with a way to start free', () => {
    const agency = pricingView({ kind: 'signed_out' }, 'month', NOW, OFF).plans.find(
      (p) => p.tier === 'agency',
    )!;
    expect(agency.action).toMatchObject({ kind: 'link', href: '/signup', label: 'Start free' });
    expect(agency.action.note).toMatch(/opens shortly/i);
    expect(agency.tag).toMatch(/opens shortly/i);
  });

  it('the no-card Pro trial stays on offer, because its route works with billing off', () => {
    const viewer = VIEWERS[2]!;
    const pro = pricingView(viewer, 'month', NOW, OFF).plans.find((p) => p.tier === 'pro')!;
    expect(pro.action).toMatchObject({ kind: 'form', action: '/api/billing/pro-trial/start' });
  });

  it('the viewer whose Pro trial is used reaches checkout with billing on, and not with it off', () => {
    const viewer = VIEWERS[VIEWERS.length - 1]!;
    const pro = (f: typeof OFF) =>
      pricingView(viewer, 'month', NOW, f).plans.find((p) => p.tier === 'pro')!.action;
    expect(targets(pro(ON))).toEqual(['/api/billing/checkout']);
    expect(pro(OFF)).toEqual({ kind: 'note', note: 'Paid plans open shortly' });
  });

  it('promises no reminder email, card charge or renewal while billing is off', () => {
    const text = allText(pricingView({ kind: 'signed_out' }, 'month', NOW, OFF));
    expect(text).not.toMatch(/days before|charged|renews|renewal|card on file|card required/i);
  });

  it('offers the Agency Plus form only when its route answers', () => {
    const view = (f: typeof OFF) => pricingView({ kind: 'signed_out' }, 'month', NOW, f);
    expect(view(OFF).agencyPlus.form).toBe(false);
    expect(view(ON).agencyPlus.form).toBe(true);
    expect(view({ ...ON, checksPublic: false }).agencyPlus.form).toBe(false);
  });

  it('with billing on, the paid paths and their promises are back', () => {
    const view = pricingView({ kind: 'signed_out' }, 'month', NOW, ON);
    const agency = view.plans.find((p) => p.tier === 'agency')!;
    expect(targets(agency.action)[0]).toMatch(/^\/agency-trial/);
    expect(allText(view)).toMatch(/days before/);
  });
});
