/**
 * /competitors (row 18, F-256): the rail's link goes to where competitors are compared, the latest
 * check's Signals page of the first site with a competitor named, and no longer answers 404.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  viewer: { kind: 'signed_out' } as Record<string, unknown>,
  dataset: null as unknown,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/v2/account/viewer', () => ({ loadViewer: async () => h.viewer }));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => ({}) }));
vi.mock('@/lib/v2/account/pages', () => ({
  readAccount: async (_s: unknown, accountId: string, seatId: string, now: Date) => ({
    d: h.dataset,
    viewer: { accountId, seatId, now: now.toISOString() },
  }),
}));

import { fixture } from '@/lib/v2/fixtures';
import CompetitorsPage from './page';

const BAD = 'a0000000-0000-4000-8000-000000000001';
const OWNER = 'e0000000-0000-4000-8000-000000000001';
const signedIn = () => ({
  kind: 'viewer',
  viewer: { account: { id: BAD }, seat: { id: OWNER }, accounts: [{ id: BAD }] },
});
/** Where the page sends the reader: the URL of the redirect it throws. */
const target = async () => {
  try {
    await CompetitorsPage();
  } catch (e) {
    const digest = String((e as { digest?: string }).digest ?? '');
    if (digest.startsWith('NEXT_REDIRECT')) return digest.split(';')[2];
    if (digest.includes('404')) return '404';
    throw e;
  }
  return 'rendered';
};

beforeEach(() => {
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  vi.stubEnv('V2_HIDE_FEATURES', '');
  h.viewer = signedIn();
  h.dataset = fixture('bad-site');
});
afterEach(() => vi.unstubAllEnvs());

describe('/competitors', () => {
  it('goes to the latest check’s Signals page of the site with a competitor named', async () => {
    const d = fixture('bad-site');
    // Worked from the fixture: the site of BAD that names a competitor, and its newest ended check.
    const site = d.sites.find((s) => s.account_id === BAD && s.competitor_hosts.length > 0)!;
    const latest = d.checks
      .filter((c) => c.site_id === site.id && (c.status === 'finished' || c.status === 'partial'))
      .sort((a, b) => Date.parse(a.finished_at!) - Date.parse(b.finished_at!))
      .at(-1)!;
    expect(await target()).toBe(`/audit/${latest.id}/signals`);
  });

  it('with no ended check of that site, goes to the site page, where competitors are named', async () => {
    const d = fixture('bad-site');
    const site = d.sites.find((s) => s.account_id === BAD && s.competitor_hosts.length > 0)!;
    h.dataset = { ...d, checks: d.checks.filter((c) => c.site_id !== site.id) };
    expect(await target()).toBe(`/sites/${site.id}`);
  });

  it('a reader with no site goes to the dashboard', async () => {
    h.dataset = { ...fixture('bad-site'), sites: [], checks: [] };
    expect(await target()).toBe('/dashboard');
  });

  it('signed out goes to sign in; with the flag off it is a 404', async () => {
    h.viewer = { kind: 'signed_out' };
    expect(await target()).toBe('/login');
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    expect(await target()).toBe('404');
  });

  it('while the RISK switch hides competitors, goes to the dashboard', async () => {
    vi.stubEnv('V2_HIDE_FEATURES', 'competitors');
    expect(await target()).toBe('/dashboard');
  });
});
