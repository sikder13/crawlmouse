import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// POST /api/fixes/[id]/done (CC-26b D5). The route's own guards over PGlite through the PostgREST
// stand-in; the re-check request (workstream A's supabaseRequestRecheck) is a fake that records
// what it is asked. What mark done does past the guards is lib/v2/account/fixes.test.ts.

const h = vi.hoisted(() => ({
  db: null as unknown as PGlite,
  user: null as string | null,
  log: [] as string[],
  asked: [] as unknown[],
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', async () => {
  const { clients } = await import('@/lib/v2/account/test-support/fix-world');
  return {
    supabaseServer: async () => {
      h.log.push('supabaseServer');
      return clients(h.db, h.user).session;
    },
  };
});
vi.mock('@/lib/supabase/admin', async () => {
  const { clients } = await import('@/lib/v2/account/test-support/fix-world');
  return {
    supabaseAdmin: () => {
      h.log.push('supabaseAdmin');
      return clients(h.db, null).admin;
    },
  };
});
vi.mock('@/lib/v2/account/sites-store', () => ({
  supabaseRequestRecheck: () => async (req: unknown) => {
    h.log.push('requestRecheck');
    h.asked.push(req);
    return { queued: true, checkId: '7a000000-0000-4000-8000-000000000001', created: false };
  },
}));

import { fixWorld, type FixWorld } from '@/lib/v2/account/test-support/fix-world';
import { POST } from './route';

let fw: FixWorld;
beforeAll(async () => {
  fw = await fixWorld();
  h.db = fw.db;
}, 120_000);
afterAll(async () => {
  await fw?.db.close();
});
beforeEach(() => {
  process.env.V2_CHECKS_PUBLIC = '1';
  process.env.V2_PIPELINE = '1';
  delete process.env.CRAWL_PAUSED;
  h.log.length = 0;
  h.asked.length = 0;
  h.user = fw.w.ownerId;
});

const post = (id: string) =>
  POST(
    new Request(`https://crawlmouse.com/api/fixes/${id}/done`, {
      method: 'POST',
      headers: { origin: 'https://crawlmouse.com', 'content-type': 'application/json' },
      body: '{}',
    }),
    { params: Promise.resolve({ id }) },
  );
const answer = async (res: Response) => [res.status, await res.json()];
const statusOf = async (id: string) =>
  (
    await fw.db.query<{ status: string }>(`select status from public.site_fixes where id = $1`, [
      id,
    ])
  ).rows[0]!.status;

describe('POST /api/fixes/[id]/done', () => {
  it('404 with V2_CHECKS_PUBLIC unset, before anything else runs', async () => {
    delete process.env.V2_CHECKS_PUBLIC;
    expect(await answer(await post(fw.ranked[0]!))).toEqual([404, { code: 'not_found' }]);
    expect(h.log).toEqual([]);
  });

  it.each([
    ['CRAWL_PAUSED', '1', 'paused'],
    ['V2_PIPELINE', '', 'unavailable'],
  ])('503 with %s=%j, before the session', async (name, value, code) => {
    process.env[name] = value;
    expect(await answer(await post(fw.ranked[0]!))).toEqual([503, { code }]);
    expect(h.log).toEqual([]);
  });

  it('401 auth_required signed out, with no service-role client', async () => {
    h.user = null;
    expect(await answer(await post(fw.ranked[0]!))).toEqual([401, { code: 'auth_required' }]);
    expect(h.log).toEqual(['supabaseServer']);
  });

  it('the same 404 for another account’s fix and a malformed id: no service role, nothing written', async () => {
    const theirs = fw.stranger.seeded.site_fixes[0]!.pk.id as string;
    for (const id of [theirs, 'not-an-id']) {
      h.log.length = 0;
      expect(await answer(await post(id))).toEqual([404, { code: 'not_found' }]);
      expect(h.log).toEqual(['supabaseServer']);
    }
    expect(await statusOf(theirs)).toBe('open');
  });

  it('a developer seat marks a visible fix on its site, and its re-check is asked', async () => {
    h.user = fw.w.scopedUserId;
    const [status, body] = await answer(await post(fw.ranked[0]!));
    expect([status, body.status]).toEqual([200, 'marked_done']);
    expect(await statusOf(fw.ranked[0]!)).toBe('marked_done');
    expect(h.asked).toEqual([
      {
        siteId: fw.w.site1,
        trigger: 'fix_recheck',
        cap: 2,
        requestedByUserId: fw.w.scopedUserId,
      },
    ]);
  });

  it('402 fixesVisible for a fix Free does not open, and nothing written', async () => {
    expect(await answer(await post(fw.ranked[4]!))).toEqual([
      402,
      { code: 'upgrade_required', gate: 'fixesVisible' },
    ]);
    expect(await statusOf(fw.ranked[4]!)).toBe('open');
    expect(h.log).not.toContain('requestRecheck');
  });
});
