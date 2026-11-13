/**
 * /dashboard behind V2_CHECKS_PUBLIC (CC-26b D1, R14). v1's page is main's file byte for byte and
 * imports nothing of v2; with the flag on the middleware rewrites /dashboard to this page
 * (`middleware.test.ts`, "the v2 rewrites (owner ruling Q17)"). This page is a 404 with the flag off,
 * and when the request did not come through that rewrite.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  viewerRead: 0,
  rewritten: true,
  viewer: { kind: 'signed_out' } as Record<string, unknown>,
  dataset: null as unknown,
  nextRead: [] as string[][],
  nextAt: null as string | null,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/v2/rewrite-target', () => ({ reachedByRewrite: async () => h.rewritten }));
vi.mock('@/lib/v2/account/viewer', () => ({
  loadViewer: async () => {
    h.viewerRead += 1;
    return h.viewer;
  },
}));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => ({}) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('@/lib/v2/account/sites-store', () => ({
  readNextChecks: async (_admin: unknown, ids: readonly string[]) => {
    h.nextRead.push([...ids]);
    return new Map(ids.map((id) => [id, h.nextAt]));
  },
}));
vi.mock('@/lib/v2/account/pages', () => ({
  readAccount: async (_s: unknown, accountId: string, seatId: string, now: Date) => ({
    d: h.dataset,
    viewer: { accountId, seatId, now: now.toISOString() },
  }),
}));

import type { ReactElement } from 'react';
import { AccountStateScreen } from '@/components/v2/screens/account/AccountStateScreen';
import { DashboardScreen } from '@/components/v2/screens/dashboard/DashboardScreen';
import { gateMessage } from '@/lib/v2/agency/gates';
import { fixture } from '@/lib/v2/fixtures';
import { noSiteDataset } from '../../(v2-preview)/v2-preview/_preview/accounts';
import V2Dashboard from './page';

type El = ReactElement<{ state?: string; data?: { firstRun: boolean; header: { title: string } } }>;
const render = (search: Record<string, string> = {}) =>
  V2Dashboard({ searchParams: Promise.resolve(search) }) as Promise<El>;
const BAD = 'a0000000-0000-4000-8000-000000000001';
const SUMMIT = { id: 'a0000000-0000-4000-8000-0000000000aa', kind: 'agency', name: 'Summit' };
const viewerOn = (
  accountId: string,
  seatId: string,
  timezone = 'UTC',
  others: (typeof SUMMIT)[] = [],
) => ({
  kind: 'viewer',
  viewer: {
    account: { id: accountId, timezone },
    seat: { id: seatId },
    accounts: [{ id: accountId, kind: 'personal', name: null }, ...others],
  },
});

const HERE = join(process.cwd(), 'app', 'dashboard');

/** sha256 of apps/web/app/dashboard/page.tsx on origin/main 607bb19a. */
const MAIN_SHA256 = '3c564084adaf59952d38a962ecd91a3ac87f54c710f482d4b3c084e2df4e4ce0';

beforeEach(() => {
  h.viewerRead = 0;
  h.rewritten = true;
  h.viewer = { kind: 'signed_out' };
  h.dataset = null;
  h.nextRead = [];
  h.nextAt = null;
});
afterEach(() => vi.unstubAllEnvs());

describe('v1 /dashboard', () => {
  it('is main’s file, byte for byte', () => {
    const source = readFileSync(join(HERE, 'page.tsx'));
    expect(createHash('sha256').update(source).digest('hex')).toBe(MAIN_SHA256);
  });
});

describe('/dashboard/v2', () => {
  it.each(['', 'true'])('is a 404 with V2_CHECKS_PUBLIC=%j, before any read', async (flag) => {
    vi.stubEnv('V2_CHECKS_PUBLIC', flag);
    await expect(V2Dashboard({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_HTTP_ERROR_FALLBACK;404'),
    });
    expect(h.viewerRead).toBe(0);
  });

  it('with the flag on but not reached through the rewrite, is a 404 before any read', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    h.rewritten = false;
    await expect(render()).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_HTTP_ERROR_FALLBACK;404'),
    });
    expect(h.viewerRead).toBe(0);
  });

  it.each(['no_account', 'ambiguous'])('a %s viewer gets that plain state', async (kind) => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    h.viewer = { kind, userId: 'u1' };
    const el = await render();
    expect(el.type).toBe(AccountStateScreen);
    expect(el.props.state).toBe(kind);
  });

  it('a viewer reads their account: day 0 with no site, the home with sites', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    const owner = fixture('bad-site').seats[0]!.id;
    h.viewer = viewerOn(BAD, owner, 'America/Indiana/Indianapolis');
    h.dataset = noSiteDataset();
    const day0 = (await render()).props as unknown as { children: El };
    expect(day0.children.type).toBe(DashboardScreen);
    expect(day0.children.props.data!.header.title).toBe('Add the site to watch');
    h.dataset = fixture('bad-site');
    const home = (await render()).props as unknown as { children: El };
    expect(home.children.props.data!.firstRun).toBe(false);
  });

  it('a person with one seat has no switcher; with a second seat the rail offers the other account', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    const owner = fixture('bad-site').seats[0]!.id;
    h.dataset = fixture('bad-site');
    type Framed = { children: ReactElement<{ data: { shell: { switcher: unknown } } }> };
    const switcher = async () =>
      ((await render()).props as unknown as Framed).children.props.data.shell.switcher;
    h.viewer = viewerOn(BAD, owner);
    expect(await switcher()).toBeNull();
    h.viewer = viewerOn(BAD, owner, 'UTC', [SUMMIT]);
    expect(await switcher()).toMatchObject({
      current: 'Personal account',
      visiting: null,
      others: [{ label: 'Summit', href: '/api/seats/switch', fields: { accountId: SUMMIT.id } }],
    });
  });

  it('a refused add is told the sites the plan keeps and the plan that lifts it, from the gate messages', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    const owner = fixture('bad-site').seats[0]!.id;
    h.dataset = fixture('bad-site');
    type Noticed = { children: ReactElement<{ notice: { code: string; text: string } | null }> };
    const notice = async (tier: string) => {
      const v = viewerOn(BAD, owner);
      h.viewer = { ...v, viewer: { ...v.viewer, tier } };
      const el = await render({ notice: 'upgrade_required' });
      return (el.props as unknown as Noticed).children.props.notice?.text;
    };
    expect(await notice('free')).toBe(gateMessage('sites', 'free'));
    expect(await notice('pro')).toBe(gateMessage('sites', 'pro'));
  });

  it('shows the first site’s next check from sites.next_check_at (CC-28 D8)', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    const bad = fixture('bad-site');
    h.viewer = viewerOn(BAD, bad.seats[0]!.id, 'America/Indiana/Indianapolis');
    h.dataset = bad;
    h.nextAt = '2026-11-13T11:37:00.000Z';
    // The page reads the clock (`new Date()`): held before the next check, so the test does not
    // expire once that moment has passed.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T09:00:00.000Z'));
    const el = await render()
      .then(
        (r) =>
          r.props as unknown as {
            children: ReactElement<{ data: { header: { line: string } } }>;
          },
      )
      .finally(() => vi.useRealTimers());
    expect(h.nextRead).toEqual([bad.sites.map((s) => s.id)]);
    expect(el.children.props.data.header.line).toContain('next check Fri 13 Nov around 06:37');
  });

  it('with the flag on, reads the viewer: signed out goes to /login', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    await expect(V2Dashboard({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({
      digest: expect.stringContaining('/login'),
    });
    expect(h.viewerRead).toBe(1);
  });
});
