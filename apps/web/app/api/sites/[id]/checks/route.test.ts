import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '@/__tests__/helpers/pglite-migrations';
import {
  addSeat,
  adminOver,
  keptSite,
  makePaid,
  person,
  sessionOver,
  type Person,
} from '@/lib/v2/account/sites-test-support';
import { globalSlot } from '@/lib/v2/account/sites-store';
import { GLOBAL_AUDITS_PER_DAY } from '@/lib/limits';

// POST /api/sites/[id]/checks, the re-check (CC-26b D4). The session and service-role clients are the
// PostgREST stand-in over PGlite with every migration applied, so membership, row security and
// request_capped_check run for real; Inngest's send and the event capture are fakes.

const h = vi.hoisted(() => ({
  log: [] as string[],
  db: null as unknown as PGlite,
  user: null as { id: string; email: string } | null,
  send: vi.fn(async (_e: unknown) => undefined),
  capture: vi.fn(async (..._a: unknown[]) => undefined),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => {
    h.log.push('supabaseServer');
    return sessionOver(h.db, h.user);
  },
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    h.log.push('supabaseAdmin');
    return adminOver(h.db);
  },
}));
vi.mock('../../../../../../../inngest/client', () => ({ inngest: { send: h.send } }));
vi.mock('@/lib/v2/account/events', async (original) => ({
  ...(await original<typeof import('@/lib/v2/account/events')>()),
  captureFor: () => h.capture,
}));

import { checkStarted } from '@/lib/v2/account/events';
import { POST } from './route';

beforeAll(async () => {
  h.db = await freshDb();
  await applyAllMigrations(h.db);
}, 300_000);
afterAll(async () => {
  await h.db?.close();
});

beforeEach(() => {
  h.log.length = 0;
  h.user = null;
  h.send.mockClear();
  h.capture.mockClear();
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  vi.stubEnv('V2_PIPELINE', '1');
  vi.stubEnv('CRAWL_PAUSED', '');
});
afterEach(() => vi.unstubAllEnvs());

/** Holds Date.now inside one 2-minute bucket, so two requests cannot fall either side of its edge. */
let pinned: { mockRestore(): void } | null = null;
const pinBucket = () => {
  pinned = vi
    .spyOn(Date, 'now')
    .mockReturnValue(Math.floor(Date.now() / 120_000) * 120_000 + 1_000);
};
afterEach(() => {
  pinned?.mockRestore();
  pinned = null;
});

const as = (p: Person | null) => {
  h.user = p && { id: p.id, email: p.email };
};

function recheck(id: string, type = 'application/json', body = '{}') {
  return POST(
    new Request(`https://crawlmouse.com/api/sites/${id}/checks`, {
      method: 'POST',
      headers: { origin: 'https://crawlmouse.com', 'content-type': type },
      body,
    }),
    { params: Promise.resolve({ id }) },
  );
}

const queued = async (siteId: string) =>
  (
    await h.db.query<{ id: string; trigger: string }>(
      `select id, trigger from public.checks where site_id = $1 and status = 'queued'`,
      [siteId],
    )
  ).rows;

/** A past re-check of the site, queued `hoursAgo` hours ago and since ended. */
const pastRecheck = (siteId: string, hoursAgo: number) =>
  h.db.query(
    `insert into public.checks (id, site_id, status, trigger, grade_version, queued_at, started_at,
                                finished_at, failure_reason)
     values ($1, $2, 'failed', 'manual', '2.0.0', now() - make_interval(hours => $3),
             now() - make_interval(hours => $3), now() - make_interval(hours => $3), 'internal')`,
    [randomUUID(), siteId, hoursAgo],
  );

describe('POST /api/sites/[id]/checks', () => {
  it('with V2_CHECKS_PUBLIC unset: 404 before anything else runs', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    const p = await person(h.db, 'off');
    const s = await keptSite(h.db, p.accountId);
    as(p);
    expect((await recheck(s.id)).status).toBe(404);
    expect(h.log).toEqual([]);
    expect(await queued(s.id)).toEqual([]);
  });

  it('CRAWL_PAUSED and V2_PIPELINE unset: 503 before the session is read', async () => {
    const p = await person(h.db, 'paused');
    const s = await keptSite(h.db, p.accountId);
    as(p);
    vi.stubEnv('CRAWL_PAUSED', '1');
    const paused = await recheck(s.id);
    expect([paused.status, await paused.json()]).toEqual([503, { code: 'paused' }]);
    vi.stubEnv('CRAWL_PAUSED', '');
    vi.stubEnv('V2_PIPELINE', '');
    const off = await recheck(s.id);
    expect([off.status, await off.json()]).toEqual([503, { code: 'unavailable' }]);
    expect(h.log).toEqual([]);
  });

  it('signed out: 401, and no service-role client', async () => {
    const res = await recheck(randomUUID());
    expect([res.status, await res.json()]).toEqual([401, { code: 'auth_required' }]);
    expect(h.log).toEqual(['supabaseServer']);
  });

  it('a stranger, a malformed id and an unknown id are the same 404, with no service-role client', async () => {
    const owner = await person(h.db, 'owner');
    const s = await keptSite(h.db, owner.accountId);
    as(await person(h.db, 'stranger'));
    for (const id of [s.id, 'not-an-id', randomUUID(), s.id.toUpperCase()]) {
      const res = await recheck(id);
      expect([res.status, await res.json()], id).toEqual([404, { code: 'not_found' }]);
    }
    expect(h.log).not.toContain('supabaseAdmin');
    expect(await queued(s.id)).toEqual([]);
  });

  it('a member queues a manual re-check, sent once, check_started once; a repeat in the bucket is not new', async () => {
    pinBucket();
    const p = await person(h.db, 'member');
    const s = await keptSite(h.db, p.accountId);
    as(p);
    const res = await recheck(s.id);
    expect(res.status).toBe(202);
    const body = (await res.json()) as { checkId: string; created: boolean };
    expect(body).toEqual({ checkId: expect.any(String), created: true });
    expect(await queued(s.id)).toEqual([{ id: body.checkId, trigger: 'manual' }]);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.capture.mock.calls).toEqual([
      ['check_started', p.accountId, checkStarted('manual', body.checkId)],
    ]);

    const again = await recheck(s.id);
    expect(await again.json()).toEqual({ checkId: body.checkId, created: false });
    expect(h.capture).toHaveBeenCalledTimes(1);
    expect(await queued(s.id)).toHaveLength(1);
  });

  it('a form post is answered with a 303 to the site’s page', async () => {
    const p = await person(h.db, 'form');
    const s = await keptSite(h.db, p.accountId);
    as(p);
    const res = await recheck(s.id, 'application/x-www-form-urlencoded', '');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/sites/${s.id}`);
  });

  it('a body with any field is 400', async () => {
    const p = await person(h.db, 'fields');
    const s = await keptSite(h.db, p.accountId);
    as(p);
    expect((await recheck(s.id, 'application/json', '{"trigger":"scheduled"}')).status).toBe(400);
    expect(await queued(s.id)).toEqual([]);
  });

  it('the third Free re-check in 24 hours is 429 with Retry-After; nothing sent, no event', async () => {
    const p = await person(h.db, 'capped');
    const s = await keptSite(h.db, p.accountId);
    await pastRecheck(s.id, 3);
    await pastRecheck(s.id, 2);
    as(p);
    const res = await recheck(s.id);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ code: 'capped', nextAllowedAt: expect.any(String) });
    const retry = Number(res.headers.get('retry-after'));
    expect(retry).toBeGreaterThan(20.9 * 3600);
    expect(retry).toBeLessThanOrEqual(21 * 3600);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.capture).not.toHaveBeenCalled();
  });

  it('a user on a Free and a Pro account gets each account’s own cap (R3)', async () => {
    const u = await person(h.db, 'both');
    const proOwner = await person(h.db, 'pro-owner');
    await makePaid(h.db, proOwner.accountId, 'pro');
    await addSeat(h.db, proOwner.accountId, u, 'developer');
    // The user acts in the Pro account by default; the Free site still has the Free cap.
    await h.db.query(`update public.users set default_account_id = $2 where id = $1`, [
      u.id,
      proOwner.accountId,
    ]);
    const freeSite = await keptSite(h.db, u.accountId);
    const proSite = await keptSite(h.db, proOwner.accountId);
    for (const s of [freeSite, proSite]) {
      await pastRecheck(s.id, 3);
      await pastRecheck(s.id, 2);
    }
    as(u);
    expect((await recheck(freeSite.id)).status).toBe(429);
    expect((await recheck(proSite.id)).status).toBe(202);
  });

  it('a developer may re-check; a scoped seat outside the site is 404', async () => {
    const owner = await person(h.db, 'agency');
    await makePaid(h.db, owner.accountId, 'agency');
    const mine = await keptSite(h.db, owner.accountId);
    const other = await keptSite(h.db, owner.accountId);
    const dev = await person(h.db, 'dev');
    await addSeat(h.db, owner.accountId, dev, 'developer', [mine.id]);
    as(dev);
    expect((await recheck(mine.id)).status).toBe(202);
    expect((await recheck(other.id)).status).toBe(404);
    expect(await queued(other.id)).toEqual([]);
  });

  it('a removed site is 404 and a paused one 409 with its reason; nothing queued or sent', async () => {
    const p = await person(h.db, 'gone');
    const removed = await keptSite(h.db, p.accountId, { removed_at: new Date().toISOString() });
    const paused = await keptSite(h.db, p.accountId, { paused_reason: 'trial_ended' });
    as(p);
    const r = await recheck(removed.id);
    expect([r.status, await r.json()]).toEqual([404, { code: 'not_found' }]);
    const q = await recheck(paused.id);
    expect([q.status, await q.json()]).toEqual([
      409,
      { code: 'site_paused', pausedReason: 'trial_ended' },
    ]);
    expect(h.send).not.toHaveBeenCalled();
    expect(await queued(paused.id)).toEqual([]);
  });

  it('a bucket check that has started is 409 check_running, nothing sent', async () => {
    pinBucket();
    const p = await person(h.db, 'running');
    const s = await keptSite(h.db, p.accountId);
    as(p);
    const first = (await (await recheck(s.id)).json()) as { checkId: string };
    await h.db.query(`select public.claim_check($1, 'run-1', '{"phase":"crawl"}'::jsonb)`, [
      first.checkId,
    ]);
    h.send.mockClear();
    h.capture.mockClear();
    const res = await recheck(s.id);
    expect([res.status, await res.json()]).toEqual([
      409,
      { code: 'check_running', checkId: first.checkId },
    ]);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.capture).not.toHaveBeenCalled();
  });
  it('at the day’s global:audits:day ceiling: 503 capacity, nothing queued or sent, the count unchanged', async () => {
    const p = await person(h.db, 'ceiling');
    const s = await keptSite(h.db, p.accountId);
    as(p);
    const g = globalSlot(Date.now());
    const read = async () =>
      (
        await h.db.query<{ request_count: number }>(
          `select request_count from public.rate_limits where bucket_key = $1 and window_start = $2`,
          [g.bucket, g.window_start],
        )
      ).rows[0]?.request_count ?? 0;
    const before = await read();
    const put = (n: number) =>
      h.db.query(
        `insert into public.rate_limits (bucket_key, window_start, request_count) values ($1, $2, $3)
         on conflict (bucket_key, window_start) do update set request_count = excluded.request_count`,
        [g.bucket, g.window_start, n],
      );
    await put(GLOBAL_AUDITS_PER_DAY);
    try {
      const res = await recheck(s.id);
      expect([res.status, await res.json()]).toEqual([503, { code: 'capacity' }]);
      expect(await read()).toBe(GLOBAL_AUDITS_PER_DAY);
    } finally {
      await put(before);
    }
    expect(await queued(s.id)).toEqual([]);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.capture).not.toHaveBeenCalled();
  });
});
