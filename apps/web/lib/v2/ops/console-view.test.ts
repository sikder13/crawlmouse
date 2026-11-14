import { describe, expect, it } from 'vitest';
import type { Dossier } from './console-store';
import { accountView, minute, resultsView, stripeLink, when } from './console-view';

const A = 'a0000000-0000-4000-8000-000000000001';
const U = 'b0000000-0000-4000-8000-000000000001';
const S1 = 'c0000000-0000-4000-8000-000000000001';
const S2 = 'c0000000-0000-4000-8000-000000000002';
const ADDRESS = ['owner', 'example.com'].join('@');

const dossier = (over: Partial<Dossier> = {}): Dossier => ({
  account: {
    id: A,
    name: 'Summit Digital',
    kind: 'agency',
    state: 'past_due',
    tier: 'agency',
    trial_ends_at: null,
    past_due_since: '2026-11-10T09:05:00.000Z',
    state_history: [
      { state: 'free', since: '2026-10-01T00:00:00.000Z' },
      { state: 'agency', since: '2026-10-02T00:00:00.000Z' },
      { state: 'past_due', since: '2026-11-10T09:05:00.000Z' },
    ],
    stripe_customer_id: 'cus_Abc123',
    internal: true,
    created_at: '2026-10-01T00:00:00.000Z',
    deleted_at: null,
  },
  seats: [
    {
      id: 's1',
      user_id: U,
      role: 'owner',
      status: 'active',
      accepted_at: '2026-10-01T00:00:00.000Z',
      removed_at: null,
    },
    {
      id: 's2',
      user_id: null,
      role: 'developer',
      status: 'invited',
      accepted_at: null,
      removed_at: null,
    },
  ],
  emails: { [U]: ADDRESS },
  sites: [
    { id: S1, host: 'one.example', paused_reason: null, removed_at: null },
    { id: S2, host: 'two.example', paused_reason: 'user', removed_at: null },
  ],
  checks: [
    {
      id: 'k1',
      site_id: S1,
      status: 'failed',
      trigger: 'scheduled',
      failure_reason: 'reaped',
      queued_at: '2026-11-12T08:00:00.000Z',
      finished_at: '2026-11-12T08:31:00.000Z',
    },
    {
      id: 'k2',
      site_id: S2,
      status: 'failed',
      trigger: 'manual',
      failure_reason: 'internal',
      queued_at: '2026-11-11T08:00:00.000Z',
      finished_at: '2026-11-11T08:02:00.000Z',
    },
    {
      id: 'k3',
      site_id: S1,
      status: 'finished',
      trigger: 'scheduled',
      failure_reason: null,
      queued_at: '2026-11-10T08:00:00.000Z',
      finished_at: '2026-11-10T08:20:00.000Z',
    },
  ],
  mail: [
    {
      id: 'm1',
      kind: 'alert',
      status: 'failed',
      attempts: 3,
      error_code: 'bounced',
      claimed_at: '2026-11-12T09:00:00.000Z',
      sent_at: null,
    },
  ],
  rules: [
    {
      id: 'r1',
      site_id: null,
      kind: 'crawler_blocked',
      enabled: true,
      channels: ['email'],
      last_fired_at: null,
    },
    {
      id: 'r2',
      site_id: S1,
      kind: 'text_drop',
      enabled: false,
      channels: ['email', 'slack'],
      last_fired_at: '2026-11-12T08:31:00.000Z',
    },
  ],
  alerts: [
    {
      id: 'e1',
      rule_id: 'r2',
      site_id: S1,
      check_id: 'k3',
      channel: 'email',
      status: 'sent',
      reason: null,
      sent_at: '2026-11-12T08:32:00.000Z',
    },
  ],
  fixes: [{ id: 'f1', site_id: S1, number: 7, type: 'orphan_pages', status: 'reopened' }],
  totals: { seats: 2, sites: 2, checks: 3, mail: 1, rules: 2, alerts: 1, fixes: 1 },
  ...over,
});

describe('what an account page leaves out', () => {
  it('is nothing when each section shows its whole count', () => {
    const v = accountView(dossier());
    expect(v.withheld).toEqual({
      seats: 0,
      sites: 0,
      checks: 0,
      mail: 0,
      rules: 0,
      alerts: 0,
      fixes: 0,
    });
    expect(v.notes).toEqual({ sites: null, rules: null });
  });

  it('is the count less what is shown, for each section, with a note where a list reads another', () => {
    const v = accountView(
      dossier({
        totals: { seats: 3, sites: 5, checks: 40, mail: 51, rules: 2, alerts: 9, fixes: 4 },
      }),
    );
    expect(v.withheld).toEqual({
      seats: 1,
      sites: 3,
      checks: 37,
      mail: 50,
      rules: 0,
      alerts: 8,
      fixes: 3,
    });
    expect(v.notes.sites).toBe('The checks and open fixes below are those of the sites shown.');
    expect(v.notes.rules).toBeNull();
    expect(accountView(dossier({ totals: { ...dossier().totals, rules: 3 } })).notes.rules).toBe(
      'The alerts below are those of the rules shown.',
    );
  });

  it('is never negative when a count was read before a row was added', () => {
    expect(
      accountView(dossier({ totals: { ...dossier().totals, checks: 0 } })).withheld.checks,
    ).toBe(0);
  });
});

describe('when', () => {
  it('writes an instant as UTC minutes, and nothing as a dash', () => {
    expect(when('2026-11-12T08:01:59.999Z')).toBe('2026-11-12 08:01 UTC');
    expect(when(null)).toBe('—');
  });
});

describe('minute', () => {
  it('writes the UTC minute with no zone, for a column whose header names UTC, and nothing as a dash', () => {
    expect(minute('2026-11-12T08:01:59.999Z')).toBe('2026-11-12 08:01');
    expect(minute(null)).toBe('—');
    expect(minute('not a time')).toBe('—');
  });
});

describe('stripeLink', () => {
  it("links a customer id to Stripe's dashboard", () => {
    expect(stripeLink('cus_Abc123')).toEqual({
      id: 'cus_Abc123',
      href: 'https://dashboard.stripe.com/customers/cus_Abc123',
    });
  });

  it('shows any other value as text, with no link', () => {
    for (const v of ['cus_', 'cus_a/b', 'cus_a?x=1', 'https://evil.example', 'sub_123'])
      expect(stripeLink(v), v).toEqual({ id: v, href: null });
    expect(stripeLink(null)).toBeNull();
  });
});

describe('accountView', () => {
  const v = accountView(dossier());

  it('names the account, marks it internal, and lists its plan facts and history', () => {
    expect(v.heading).toBe('Summit Digital');
    expect(v.internal).toBe(true);
    expect(v.facts).toEqual([
      { label: 'Account id', value: A },
      { label: 'Kind', value: 'agency' },
      { label: 'State', value: 'past_due' },
      { label: 'Tier', value: 'agency' },
      { label: 'Trial ends', value: '—' },
      { label: 'Past due since', value: '2026-11-10 09:05 UTC' },
      { label: 'Created', value: '2026-10-01 00:00 UTC' },
      { label: 'Deleted', value: '—' },
    ]);
    expect(v.history).toEqual([
      { state: 'free', since: '2026-10-01 00:00 UTC' },
      { state: 'agency', since: '2026-10-02 00:00 UTC' },
      { state: 'past_due', since: '2026-11-10 09:05 UTC' },
    ]);
    expect(v.stripe).toEqual({
      id: 'cus_Abc123',
      href: 'https://dashboard.stripe.com/customers/cus_Abc123',
    });
  });

  it('an account with no name is named by its id', () => {
    expect(accountView(dossier({ account: { ...dossier().account, name: null } })).heading).toBe(
      `Account ${A.slice(0, 8)}`,
    );
  });

  it("offers a re-send only on an active seat's user", () => {
    expect(v.seats.map((s) => [s.email, s.role, s.status, s.resendUserId])).toEqual([
      [ADDRESS, 'owner', 'active', U],
      ['—', 'developer', 'invited', null],
    ]);
  });

  it('offers a re-run only on a failed check of a site that is kept, not paused and not removed', () => {
    expect(v.checks.map((c) => [c.id, c.host, c.status, c.failure, c.rerun])).toEqual([
      ['k1', 'one.example', 'failed', 'reaped', true],
      ['k2', 'two.example', 'failed', 'internal', false],
      ['k3', 'one.example', 'finished', '—', false],
    ]);
  });

  it('writes the checks list times as UTC minutes, for its "(UTC)" headers', () => {
    expect(v.checks.map((c) => c.queued)).toEqual([
      '2026-11-12 08:00',
      '2026-11-11 08:00',
      '2026-11-10 08:00',
    ]);
  });

  it('shows the mail ledger, alert rules, alert events and open fixes by site host', () => {
    expect(v.mail).toEqual([
      expect.objectContaining({
        kind: 'alert',
        status: 'failed',
        attempts: '3',
        error: 'bounced',
        sent: '—',
      }),
    ]);
    expect(v.rules.map((r) => [r.kind, r.scope, r.enabled, r.channels])).toEqual([
      ['crawler_blocked', 'Account', 'on', 'email'],
      ['text_drop', 'one.example', 'off', 'email, slack'],
    ]);
    expect(v.alerts.map((a) => [a.kind, a.site, a.channel, a.status])).toEqual([
      ['text_drop', 'one.example', 'email', 'sent'],
    ]);
    expect(v.fixes).toEqual([
      { key: 'f1', number: '7', type: 'orphan_pages', status: 'reopened', host: 'one.example' },
    ]);
    expect(v.sites.map((s) => [s.host, s.state])).toEqual([
      ['one.example', 'active'],
      ['two.example', 'paused (user)'],
    ]);
  });
});

describe('resultsView', () => {
  it('lists each account found with its state, in the order asked, and the internal mark', () => {
    const a = dossier().account;
    const b = { ...a, id: 'a0000000-0000-4000-8000-000000000002', name: null, internal: false };
    expect(resultsView([b.id, a.id], [a, b])).toEqual([
      {
        id: b.id,
        href: `/internal/accounts/${b.id}`,
        name: 'Account a0000000',
        kind: 'agency',
        state: 'past_due',
        tier: 'agency',
        internal: false,
        deleted: false,
      },
      {
        id: a.id,
        href: `/internal/accounts/${a.id}`,
        name: 'Summit Digital',
        kind: 'agency',
        state: 'past_due',
        tier: 'agency',
        internal: true,
        deleted: false,
      },
    ]);
  });
});
