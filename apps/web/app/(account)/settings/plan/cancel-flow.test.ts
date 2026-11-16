/**
 * Cancel from Settings › Plan, end to end in memory (CC-39 D1, walk-findings item 6): the form the
 * plan card renders is posted as a form, the handler (lib/billing/cancel.ts) answers the first post
 * with the confirm step and no Stripe write, the card rendered for that step posts the second, and
 * Stripe (the repo's StripeFake) ends up set to cancel at the period's end.
 */
import { describe, expect, it } from 'vitest';
import { ACCOUNT_VIEWERS } from '../../../(v2-preview)/v2-preview/_preview/accounts';
import {
  cancelResponse,
  cancelSubscription,
  parseCancel,
  type CancelDeps,
} from '../../../../lib/billing/cancel';
import { readBody } from '../../../../lib/billing/request-body';
import { StripeFake, stripeSubscription } from '../../../../lib/billing/stripe.fake';
import { fixture } from '../../../../lib/v2/fixtures';
import type { ActionView } from '../../../../lib/v2/view/account-actions';
import { cancelStepFrom, settingsView } from '../../../../lib/v2/view/settings';

const ORIGIN = 'https://crawlmouse.com';
const SUB = 'sub_cc39flow';
const PERIOD_END = Date.parse('2026-11-01T14:00:00Z') / 1000;

function world() {
  const stripe = new StripeFake();
  stripe.put({
    id: SUB,
    customer: 'cus_cc39flow',
    status: 'active',
    plan: 'agency',
    interval: 'month',
    seats: 0,
    sites: 0,
    trialEnd: null,
    periodEnd: PERIOD_END,
    cancelAtPeriodEnd: false,
  });
  const writes: string[] = [];
  const deps: CancelDeps = {
    accounts: {
      followed: async () => ({
        id: SUB,
        mirror: { status: 'active', trialEnd: null, currentPeriodEnd: new Date(PERIOD_END * 1000) },
      }),
    },
    stripe: {
      subscriptions: {
        retrieve: (id) => stripe.retrieveSubscription(id),
        update: async (id, params) => {
          writes.push(`update ${JSON.stringify(params)}`);
          stripe.update(id, { cancelAtPeriodEnd: params.cancel_at_period_end === true });
          return stripeSubscription(stripe.get(id));
        },
        cancel: async (id) => {
          writes.push('cancel');
          stripe.update(id, { status: 'canceled' });
          return stripeSubscription(stripe.get(id));
        },
      },
    },
    now: () => new Date('2026-10-31T12:00:00Z'),
  };
  return { stripe, writes, deps };
}

/** Posts a rendered form control as the browser would, and answers as the route does. */
async function submit(deps: CancelDeps, control: ActionView) {
  expect(control).toMatchObject({ href: '/api/billing/cancel', method: 'post' });
  // The hidden fields as the browser encodes them, read by the route's own body reader.
  const body = await readBody(
    new Request(`${ORIGIN}${control.href}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(control.fields).toString(),
    }),
  );
  const input = parseCancel(body!);
  expect(input, 'the handler reads the fields the card renders').not.toBeNull();
  const result = await cancelSubscription(deps, {
    accountId: input!.accountId!,
    confirmed: input!.confirmed,
  });
  return cancelResponse('form', ORIGIN, result);
}

const agency = fixture('challenged-site');
const viewer = { accountId: ACCOUNT_VIEWERS.withheld().accountId, now: '2026-10-31T12:00:00Z' };

describe('Settings › Plan: ask, confirm, Stripe cancels at the period’s end', () => {
  it('takes exactly two clicks, and only the second writes to Stripe', async () => {
    const { stripe, writes, deps } = world();
    const first = settingsView(agency, viewer, { role: 'owner', subscriptionStatus: 'active' }).plan
      .terms[0]!.action!;

    const asked = await submit(deps, first);
    expect(asked.status).toBe(303);
    const back = new URL(asked.headers.get('location')!);
    expect(back.pathname).toBe('/settings/plan');
    expect(writes).toEqual([]);
    expect(stripe.get(SUB).cancelAtPeriodEnd).toBe(false);

    // The page the redirect lands on, for the parameter it carries.
    const page = settingsView(agency, viewer, {
      role: 'owner',
      subscriptionStatus: 'active',
      cancelStep: cancelStepFrom(back.searchParams.get('cancel') ?? undefined),
    }).plan;
    expect(page.confirm, 'the second click is on the page').not.toBeNull();

    const done = await submit(deps, page.confirm!.action);
    expect([done.status, done.headers.get('location')]).toEqual([
      303,
      `${ORIGIN}/settings/plan?cancel=done`,
    ]);
    expect(writes).toEqual(['update {"cancel_at_period_end":true}']);
    expect(stripe.get(SUB)).toMatchObject({ status: 'active', cancelAtPeriodEnd: true });
  });
});
