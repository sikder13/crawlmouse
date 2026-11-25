/**
 * Integrations: the Slack card for each state of an account and each role that sees the page,
 * against the bad-site fixture (Pro) and the clean-site one (Free).
 */
import { describe, expect, it } from 'vitest';
import { CLEAN_VIEWER } from '../../../app/(v2-preview)/v2-preview/_preview/accounts';
import { fixture } from '../fixtures';
import type { AccountDataset, Viewer } from './account';
import { dashboardView } from './dashboard';
import { integrationsView, withSlackConnected } from './integrations';

const bad = fixture('bad-site');
const PRO = { accountId: 'a0000000-0000-4000-8000-000000000001', now: bad.as_of };
const slack = (v: ReturnType<typeof integrationsView>) => v.cards.find((c) => c.key === 'slack')!;
const pro = (last4: string | null) => slack(integrationsView(bad, PRO, last4, 'owner'));
const free = (last4: string | null = null, role: 'owner' | 'account_manager' = 'owner') =>
  slack(integrationsView(fixture('clean-site'), CLEAN_VIEWER, last4, role));

describe('Integrations, Slack', () => {
  it('not connected: one form with the webhook field, posting PUT to the account route', () => {
    const s = pro(null);
    expect(s.status).toEqual({ state: 'neutral', label: 'not connected' });
    expect(s.connect).toMatchObject({
      label: 'Connect Slack',
      href: '/api/alert-rules',
      method: 'post',
      fields: { _method: 'PUT' },
    });
    expect(s.connect!.inputs).toEqual([
      expect.objectContaining({
        kind: 'text',
        name: 'slackWebhookUrl',
        type: 'url',
        required: true,
        autoComplete: 'off',
      }),
    ]);
    expect(s.disconnect).toBeNull();
    expect(s.upgrade).toBeNull();
  });

  it('connected: says the last four, offers replace and disconnect', () => {
    const s = pro('WXYZ');
    expect(s.status).toEqual({ state: 'ok', label: 'connected' });
    expect(s.body).toContain('WXYZ');
    expect(s.connect!.label).toBe('Replace webhook');
    expect(s.connect!.inputs![0]).toMatchObject({ name: 'slackWebhookUrl', required: true });
    expect(s.disconnect).toMatchObject({
      label: 'Disconnect',
      href: '/api/alert-rules',
      fields: { _method: 'PUT', clearSlack: 'true' },
    });
    expect(s.upgrade).toBeNull();
    expect(s.test).toMatchObject({
      label: 'Send a test message',
      href: '/api/alert-rules',
      fields: { _method: 'PUT', testSlack: 'true' },
    });
    expect(pro(null).test).toBeNull();
    expect(free('WXYZ').test).toBeNull();
  });

  it('on Free, for the owner: no form, and the way to Pro', () => {
    const s = free();
    expect(s.status).toEqual({ state: 'neutral', label: 'on Pro' });
    expect(s.connect).toBeNull();
    expect(s.disconnect).toBeNull();
    expect(s.upgrade).toMatchObject({ href: '/settings/plan', method: 'get' });
  });

  it('on Free, for an account manager: no link to a plan page they cannot open', () => {
    const s = free(null, 'account_manager');
    expect(s.upgrade).toBeNull();
    expect(s.body).toContain('owner');
  });

  it('on Free with a destination kept from a trial: says so, and offers to remove it', () => {
    const s = free('WXYZ');
    expect(s.status.label).toBe('on Pro');
    expect(s.body).toContain('WXYZ');
    expect(s.body).toContain('do not post');
    expect(s.connect).toBeNull();
    expect(s.disconnect).toMatchObject({ fields: { _method: 'PUT', clearSlack: 'true' } });
  });

  it('marks Integrations as the current page on the rail, for the role given', () => {
    const shell = integrationsView(bad, PRO, null, 'account_manager').shell;
    expect(shell.nav.filter((n) => n.current).map((n) => n.label)).toEqual(['Integrations']);
    // The rail's Keep is the owner's alone; an account manager's rail does not offer it.
    expect(shell.trial?.keep ?? null).toBeNull();
    expect(integrationsView(bad, PRO, null, 'owner').shell.trial?.keep).toBeTruthy();
  });
});

describe('whether Slack is connected, as the account pages read it', () => {
  // As a live account reads: no table records a connection, so the list starts empty.
  const live: AccountDataset = {
    ...bad,
    accounts: bad.accounts.map((a) => ({ ...a, integrations: [] })),
  };
  const slackItem = (d: AccountDataset, viewer: Viewer = PRO) =>
    dashboardView(d, viewer).setup!.items.find((i) => i.key === 'slack')!;

  it('with no destination, the set-up list still offers Slack', () => {
    expect(slackItem(withSlackConnected(live, PRO.accountId, false)).done).toBe(false);
  });

  it('with one, the set-up list ticks it', () => {
    expect(slackItem(withSlackConnected(live, PRO.accountId, true)).done).toBe(true);
  });

  it('changes only the account it names', () => {
    const out = withSlackConnected(live, 'a0000000-0000-4000-8000-00000000ffff', true);
    expect(out.accounts.every((a) => a.integrations.length === 0)).toBe(true);
  });

  it('a developer is offered no Connect, which would lead to a page they cannot open', () => {
    const owner = live.seats.find((s) => s.role === 'owner')!;
    const seat = {
      ...owner,
      id: '50000000-0000-4000-8000-0000000000d1',
      role: 'developer' as const,
    };
    const item = slackItem({ ...live, seats: [...live.seats, seat] }, { ...PRO, seatId: seat.id });
    expect(item.done).toBe(false);
    expect(item.action).toBeNull();
    // The owner's row has it: the case above is not vacuous.
    expect(slackItem(live).action).not.toBeNull();
  });
});
