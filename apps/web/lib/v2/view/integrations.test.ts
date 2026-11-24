/**
 * Integrations: the Slack card for each state of an account, against the bad-site fixture (Pro) and
 * the clean-site one (Free).
 */
import { describe, expect, it } from 'vitest';
import { CLEAN_VIEWER } from '../../../app/(v2-preview)/v2-preview/_preview/accounts';
import { fixture } from '../fixtures';
import type { AccountDataset } from './account';
import { dashboardView } from './dashboard';
import { integrationsView, withSlackConnected } from './integrations';

const bad = fixture('bad-site');
const PRO = { accountId: 'a0000000-0000-4000-8000-000000000001', now: bad.as_of };
const pro = (last4: string | null) => integrationsView(bad, PRO, last4).slack;
const free = () => integrationsView(fixture('clean-site'), CLEAN_VIEWER, null).slack;

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
  });

  it('holds no address: only the four characters it was given', () => {
    expect(JSON.stringify(pro('WXYZ'))).not.toContain('hooks.slack.com/services/T');
  });

  it('on Free: no form, and the way to Pro', () => {
    const s = free();
    expect(s.status).toEqual({ state: 'neutral', label: 'on Pro' });
    expect(s.connect).toBeNull();
    expect(s.disconnect).toBeNull();
    expect(s.upgrade).toMatchObject({ href: '/settings/plan', method: 'get' });
  });

  it('on Free, a stored destination is not offered as connected', () => {
    const s = integrationsView(fixture('clean-site'), CLEAN_VIEWER, 'WXYZ').slack;
    expect(s.status.label).toBe('on Pro');
    expect(s.body).not.toContain('WXYZ');
    expect(s.connect).toBeNull();
  });

  it('marks Integrations as the current page on the rail', () => {
    const { shell } = integrationsView(bad, PRO, null);
    expect(JSON.stringify(shell)).toContain('/settings/integrations');
  });
});

describe('whether Slack is connected, as the account pages read it', () => {
  // As a live account reads: no table records a connection, so the list starts empty.
  const live: AccountDataset = {
    ...bad,
    accounts: bad.accounts.map((a) => ({ ...a, integrations: [] })),
  };
  const slackItem = (d: AccountDataset) =>
    dashboardView(d, PRO).setup!.items.find((i) => i.key === 'slack')!;

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
});
