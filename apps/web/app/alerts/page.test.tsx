/**
 * /alerts and /changes behind V2_CHECKS_PUBLIC (CC-28 D8): a 404 with the flag off before anything is
 * read, the sign-in page when signed out, the plain account states, and otherwise the screens over the
 * account's records, read for the caller's own seat.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  viewerRead: 0,
  viewer: { kind: 'signed_out' } as Record<string, unknown>,
  dataset: null as unknown,
  read: [] as { accountId: string; seatId: string }[],
  slackLast4: null as string | null,
  seeded: [] as string[],
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/v2/account/viewer', () => ({
  loadViewer: async () => {
    h.viewerRead += 1;
    return h.viewer;
  },
}));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => ({}) }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: async (fn: string, args: { p_account?: string }) => {
      if (fn === 'account_slack_last4') return { data: h.slackLast4, error: null };
      if (fn === 'seed_default_alert_rules') {
        h.seeded.push(`${args.p_account}@read${h.read.length}`);
        return { data: null, error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${fn}` } };
    },
  }),
}));
vi.mock('@/lib/v2/account/pages', () => ({
  readAccount: async (_s: unknown, accountId: string, seatId: string, now: Date) => {
    h.read.push({ accountId, seatId });
    return { d: h.dataset, viewer: { accountId, seatId, now: now.toISOString() } };
  },
}));

import type { ReactElement } from 'react';
import { AccountStateScreen } from '@/components/v2/screens/account/AccountStateScreen';
import { AlertsScreen } from '@/components/v2/screens/alerts/AlertsScreen';
import { ChangesLogScreen } from '@/components/v2/screens/changes-log/ChangesLogScreen';
import { REFUSAL_SENTENCES } from '@/lib/v2/copy/settings-notices';
import { fixture } from '@/lib/v2/fixtures';
import ChangesPage from '../changes/page';
import AlertsPage from './page';

type Q = Record<string, string | string[] | undefined>;
type El = ReactElement<Record<string, unknown>>;
const PAGES = {
  alerts: (q: Q = {}) => AlertsPage({ searchParams: Promise.resolve(q) }) as Promise<El>,
  changes: (q: Q = {}) => ChangesPage({ searchParams: Promise.resolve(q) }) as Promise<El>,
};
const BAD = 'a0000000-0000-4000-8000-000000000001';
const OWNER = 'e0000000-0000-4000-8000-000000000001';
const signedIn = () => ({
  kind: 'viewer',
  viewer: {
    account: { id: BAD, timezone: 'America/Indiana/Indianapolis' },
    seat: { id: OWNER },
    accounts: [{ id: BAD, kind: 'personal', name: null }],
  },
});
const child = async (el: Promise<El>) => ((await el).props as { children: El }).children;

beforeEach(() => {
  h.viewerRead = 0;
  h.viewer = { kind: 'signed_out' };
  h.dataset = null;
  h.read.length = 0;
  h.slackLast4 = null;
  h.seeded.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe.each(Object.entries(PAGES))('/%s', (_name, render) => {
  it.each(['', 'true'])('is a 404 with V2_CHECKS_PUBLIC=%j, before any read', async (flag) => {
    vi.stubEnv('V2_CHECKS_PUBLIC', flag);
    await expect(render()).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_HTTP_ERROR_FALLBACK;404'),
    });
    expect(h.viewerRead).toBe(0);
  });

  it('sends a signed-out caller to sign in, reading no records', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    await expect(render()).rejects.toMatchObject({ digest: expect.stringContaining('/login') });
    expect(h.read).toEqual([]);
  });

  it.each(['no_account', 'ambiguous'])('a %s viewer gets that plain state', async (kind) => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    h.viewer = { kind, userId: 'u1' };
    const el = await render();
    expect(el.type).toBe(AccountStateScreen);
    expect(el.props.state).toBe(kind);
    expect(h.read).toEqual([]);
  });
});

describe('/alerts, signed in', () => {
  it('reads the account for the caller’s seat and draws Alerts from it', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    h.viewer = signedIn();
    h.dataset = fixture('bad-site');
    const el = await child(PAGES.alerts());
    expect(el.type).toBe(AlertsScreen);
    expect(h.read).toEqual([{ accountId: BAD, seatId: OWNER }]);
    // The account's default rules are seeded before the read (Q13): `@read0` is the count of reads then.
    expect(h.seeded).toEqual([`${BAD}@read0`]);
    const data = el.props.data as { fired: { rows: unknown[] }; rules: { rows: unknown[] } };
    expect(data.fired.rows.length).toBeGreaterThan(0);
    expect(data.rules.rows).toHaveLength(6);
    expect(el.props.notice).toBeNull();
  });

  it('shows the line for a refused form’s ?error=', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    h.viewer = signedIn();
    h.dataset = fixture('bad-site');
    const el = await child(PAGES.alerts({ error: 'upgrade_required' }));
    expect(el.props.notice).toEqual({ tone: 'error', text: REFUSAL_SENTENCES.upgrade_required });
  });

  it('an account with no rules and nothing sent says so in words, not a blank table', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    h.viewer = signedIn();
    const d = structuredClone(fixture('bad-site'));
    d.alert_rules = [];
    d.changes = d.changes.map((c) => ({ ...c, notified: null }));
    h.dataset = d;
    const el = await child(PAGES.alerts());
    const data = el.props.data as {
      fired: { rows: unknown[]; empty: string | null };
      rules: { rows: unknown[]; empty: string | null };
    };
    expect([data.fired.rows, data.rules.rows]).toEqual([[], []]);
    expect(data.fired.empty).toMatch(/^Nothing has been sent yet\./);
    expect(data.rules.empty).toBeTruthy();
  });
});

describe('/alerts, where alerts go', () => {
  // bad-site's account at its as_of, in its Pro trial (Slack open), with no integration recorded in
  // the dataset, as a live account never has one.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(fixture('bad-site').as_of));
  });
  afterEach(() => vi.useRealTimers());

  const slackRow = async (last4: string | null) => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    h.viewer = signedIn();
    const d = structuredClone(fixture('bad-site'));
    d.accounts[0]!.integrations = [];
    h.dataset = d;
    h.slackLast4 = last4;
    const data = (await child(PAGES.alerts())).props.data as {
      channels: { rows: { label: string; value: string; state: { label: string } | null }[] };
    };
    return data.channels.rows.find((r) => r.label === 'Slack')!;
  };

  it('says Slack is on when the account has a destination set, naming no channel it does not know', async () => {
    expect(await slackRow('WXYZ')).toMatchObject({ value: 'Slack', state: { label: 'on' } });
  });

  it('says not connected when none is set', async () => {
    expect(await slackRow(null)).toMatchObject({
      value: 'not connected',
      state: { label: 'off' },
    });
  });
});

describe('/changes, signed in', () => {
  it('reads the filters from the query, one value each, and points them at /changes', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    h.viewer = signedIn();
    h.dataset = fixture('bad-site');
    const all = await child(PAGES.changes());
    expect(all.type).toBe(ChangesLogScreen);
    const allData = all.props.data as { rows: unknown[]; filters: { links: { href: string }[] }[] };
    expect(allData.rows.length).toBeGreaterThan(0);
    expect(
      allData.filters.flatMap((f) => f.links).every((l) => l.href.startsWith('/changes')),
    ).toBe(true);
    const opened = (await child(PAGES.changes({ kind: 'opened' }))).props.data as {
      rows: { kind?: string }[];
    };
    expect(opened.rows.length).toBeGreaterThan(0);
    expect(opened.rows.length).toBeLessThan(allData.rows.length);
    // A repeated parameter is no filter.
    const repeated = (await child(PAGES.changes({ kind: ['opened', 'opened'] }))).props.data as {
      rows: unknown[];
    };
    expect(repeated.rows).toHaveLength(allData.rows.length);
  });

  it('an account with no change says so in words', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    h.viewer = signedIn();
    const d = structuredClone(fixture('bad-site'));
    d.changes = [];
    h.dataset = d;
    const data = (await child(PAGES.changes())).props.data as {
      rows: unknown[];
      empty: string | null;
    };
    expect(data.rows).toEqual([]);
    expect(data.empty).toBeTruthy();
  });
});
