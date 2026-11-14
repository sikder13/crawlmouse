/**
 * Settings › Plan reads the cancel route's `?cancel=confirm` (CC-39 D1, walk-findings item 6): with
 * it, the owner's page carries the second click, a form that sends `confirm`; without it, or for
 * anyone but the owner, it does not. The page's read is a fake over the challenged-site fixture.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ read: null as unknown }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/v2/account/settings-pages', () => ({ readSettingsPage: async () => h.read }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));

import { ACCOUNT_VIEWERS } from '../../../(v2-preview)/v2-preview/_preview/accounts';
import { fixture } from '@/lib/v2/fixtures';
import PlanPage from './page';

const accountId = ACCOUNT_VIEWERS.withheld().accountId;
const withoutCard = (d: ReturnType<typeof fixture>) => ({
  ...d,
  accounts: d.accounts.map((a) => (a.id === accountId ? { ...a, card_last4: null } : a)),
});
const read = (role: string) => ({
  kind: 'account',
  userId: 'u1',
  seatId: 's1',
  role,
  // The card is left unrecorded, as on every live account (F8): the portal follows the subscription.
  d: withoutCard(fixture('challenged-site')),
  viewer: { accountId, now: '2026-10-31T12:00:00Z' },
  billingEnd: null,
  subscriptionStatus: 'active',
  accounts: [],
  ownPersonalId: accountId,
  undeliverable: null,
});

const render = async (cancel?: string) =>
  renderToStaticMarkup(
    await PlanPage({ searchParams: Promise.resolve(cancel === undefined ? {} : { cancel }) }),
  );

/** The forms on the page that post to the cancel route, by whether they carry `confirm`. */
const cancelForms = (html: string) =>
  [...html.matchAll(/<form [^>]*action="\/api\/billing\/cancel"[^>]*>([\s\S]*?)<\/form>/g)].map(
    ([, inner]) => /name="confirm" value="true"/.test(inner!),
  );

beforeEach(() => {
  process.env.V2_CHECKS_PUBLIC = '1';
  h.read = read('owner');
});

describe('Settings › Plan and the cancel step', () => {
  it('without the parameter: the first click only', async () => {
    expect(cancelForms(await render())).toEqual([false]);
  });

  it('after the first click: the second, in its place, saying when the plan ends', async () => {
    const html = await render('confirm');
    expect(cancelForms(html)).toEqual([true]);
    expect(html).toContain('Agency runs until Sun 1 Nov');
    expect(html).toContain('Yes, cancel Agency');
  });

  it('any other value is no step', async () => {
    for (const v of ['done', 'yes', '']) expect(cancelForms(await render(v)), v).toEqual([false]);
  });

  it('anyone but the owner gets a 404, confirm or not', async () => {
    for (const role of ['account_manager', 'developer']) {
      h.read = read(role);
      await expect(render('confirm'), role).rejects.toThrow('NEXT_NOT_FOUND');
    }
  });

  it('the billing portal is offered for the subscription', async () => {
    expect(await render()).toMatch(/action="\/api\/billing\/portal"/);
  });
});
