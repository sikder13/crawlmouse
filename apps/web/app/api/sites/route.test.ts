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
import { domainSlot, globalSlot } from '@/lib/v2/account/sites-store';
import { GLOBAL_AUDITS_PER_DAY } from '@/lib/limits';

// POST /api/sites (CC-26b D6). The session and service-role clients are the PostgREST stand-in over
// PGlite with every migration applied, so membership, row security and migration 20261112000001's
// add_site run for real; Inngest's send, the engine's DNS check and the event capture are fakes.

const h = vi.hoisted(() => ({
  log: [] as string[],
  db: null as unknown as PGlite,
  user: null as { id: string; email: string } | null,
  send: vi.fn(async (_e: unknown) => undefined),
  capture: vi.fn(async (..._a: unknown[]) => undefined),
  agencyCapture: vi.fn(async (..._a: unknown[]) => undefined),
  refused: new Set<string>(),
  /** The switcher cookie's value on this request, or null for none. */
  chosen: null as string | null,
}));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'cm_account' && h.chosen !== null ? { name, value: h.chosen } : undefined,
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => {
    h.log.push('supabaseServer');
    return sessionOver(h.db, h.user);
  },
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    h.log.push('supabaseAdmin');
    const admin = adminOver(h.db);
    return {
      from: (table: string) => admin.from(table),
      rpc: (fn: string, args: object) => {
        h.log.push(`admin.rpc ${fn}`);
        return admin.rpc(fn, args);
      },
    };
  },
}));
vi.mock('../../../../../inngest/client', () => ({ inngest: { send: h.send } }));
vi.mock('@/lib/auth/admit-site', () => ({
  admitSiteHost: async (host: string) => {
    h.log.push(`admit ${host}`);
    return !h.refused.has(host);
  },
}));
vi.mock('@/lib/v2/account/events', async (original) => ({
  ...(await original<typeof import('@/lib/v2/account/events')>()),
  captureFor: () => h.capture,
}));

vi.mock('@/lib/v2/agency/events', async (original) => ({
  ...(await original<typeof import('@/lib/v2/agency/events')>()),
  agencyCaptureFor: () => h.agencyCapture,
}));

import { checkStarted } from '@/lib/v2/account/events';
import { agencyAccount } from '@/lib/v2/agency/test-support';
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
  h.chosen = null;
  h.send.mockClear();
  h.capture.mockClear();
  h.agencyCapture.mockClear();
  h.refused = new Set(['private.example']);
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  vi.stubEnv('V2_PIPELINE', '1');
  vi.stubEnv('CRAWL_PAUSED', '');
});
afterEach(() => vi.unstubAllEnvs());

const as = (p: Person | null) => {
  h.user = p && { id: p.id, email: p.email };
};

function post(body: string, type = 'application/json', referer?: string): Request {
  return new Request('https://crawlmouse.com/api/sites', {
    method: 'POST',
    headers: {
      origin: 'https://crawlmouse.com',
      'content-type': type,
      ...(referer ? { referer } : {}),
    },
    body,
  });
}

/** A form's post of `url`, as the page at `from` sends it. */
const form = (url: string, from: string) =>
  post(`url=${url}`, 'application/x-www-form-urlencoded', `https://crawlmouse.com${from}`);

const json = (v: unknown) => post(JSON.stringify(v));

const sitesOf = async (accountId: string) =>
  (
    await h.db.query<{
      id: string;
      host: string;
      schedule_cadence: string | null;
      owner_seat_id: string;
    }>(
      `select id, host, schedule_cadence, owner_seat_id from public.sites
        where account_id = $1 and removed_at is null order by created_at`,
      [accountId],
    )
  ).rows;

const setDefault = (p: Person, accountId: string) =>
  h.db.query(`update public.users set default_account_id = $2 where id = $1`, [p.id, accountId]);

/** Sets a bucket's count in its current window; returns a restore. */
async function setCount(slot: { bucket: string; window_start: string }, n: number) {
  const { rows } = await h.db.query<{ request_count: number }>(
    `select request_count from public.rate_limits where bucket_key = $1 and window_start = $2`,
    [slot.bucket, slot.window_start],
  );
  const before = rows[0]?.request_count ?? 0;
  const put = (v: number) =>
    h.db.query(
      `insert into public.rate_limits (bucket_key, window_start, request_count) values ($1, $2, $3)
       on conflict (bucket_key, window_start) do update set request_count = excluded.request_count`,
      [slot.bucket, slot.window_start, v],
    );
  await put(n);
  return () => put(before);
}

describe('POST /api/sites', () => {
  it('with V2_CHECKS_PUBLIC unset: 404 before anything else runs', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    as(await person(h.db, 'off'));
    const res = await POST(json({ url: 'example.com' }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: 'not_found' });
    expect(h.log).toEqual([]);
  });

  it('CRAWL_PAUSED: 503 before the session is read', async () => {
    vi.stubEnv('CRAWL_PAUSED', '1');
    as(await person(h.db, 'paused'));
    const res = await POST(json({ url: 'example.com' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ code: 'paused' });
    expect(h.log).toEqual([]);
  });

  it('V2_PIPELINE unset: 503 pipeline_off before the session is read', async () => {
    vi.stubEnv('V2_PIPELINE', '');
    as(await person(h.db, 'nopipe'));
    const res = await POST(json({ url: 'example.com' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ code: 'unavailable' });
    expect(h.log).toEqual([]);
  });

  it('signed out: 401, and no service-role client', async () => {
    const res = await POST(json({ url: 'example.com' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: 'auth_required' });
    expect(h.log).toEqual(['supabaseServer']);
  });

  it('the owner of a Free account adds its first site: monthly schedule, its first audit queued and sent, the events once', async () => {
    const p = await person(h.db, 'owner');
    as(p);
    const res = await POST(json({ url: 'https://Shop.Example/products' }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { siteId: string; checkId: string };
    expect(body).toEqual({ siteId: expect.any(String), checkId: expect.any(String) });
    expect(await sitesOf(p.accountId)).toEqual([
      {
        id: body.siteId,
        host: 'shop.example',
        schedule_cadence: 'monthly',
        owner_seat_id: p.seatId,
      },
    ]);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send.mock.calls[0]![0]).toMatchObject({
      name: 'check.requested',
      data: { checkId: body.checkId, siteId: body.siteId, trigger: 'first_audit' },
    });
    expect(h.capture.mock.calls).toEqual([
      ['site_added', p.accountId, { n: 1 }],
      ['check_started', p.accountId, checkStarted('first_audit', body.checkId)],
    ]);
  });

  it('a form post is answered with a 303 to the new site’s page', async () => {
    as(await person(h.db, 'form'));
    const res = await POST(post('url=form.example', 'application/x-www-form-urlencoded'));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toMatch(/^\/sites\/[0-9a-f-]{36}$/);
  });

  it('a form from the client matrix goes back to it: with the new client on success, with its notice when refused', async () => {
    const p = await person(h.db, 'agency-form');
    const agency = await agencyAccount(h.db, p);
    as(p);
    h.chosen = agency.accountId;
    const added = await POST(form('client-one.example', '/agency'));
    expect(added.status).toBe(303);
    expect(added.headers.get('location')).toBe('/agency');
    expect((await sitesOf(agency.accountId)).map((s) => s.host)).toEqual(['client-one.example']);
    const again = await POST(form('client-one.example', '/agency'));
    expect(again.status).toBe(303);
    expect(again.headers.get('location')).toBe('/agency?notice=site_exists');
    const refused = await POST(form('private.example', '/agency'));
    expect(refused.headers.get('location')).toBe('/agency?notice=host_refused');
  });

  it('a form from any other page, or from another origin, goes back to the dashboard as before', async () => {
    as(await person(h.db, 'elsewhere'));
    for (const referer of [
      'https://crawlmouse.com/agency/reports',
      'https://crawlmouse.com/agency/clients/50000000-0000-4000-8000-0000000000c9',
      'https://crawlmouse.com/sites/50000000-0000-4000-8000-0000000000c9',
      'https://crawlmouse.com/settings',
      'https://evil.example/agency',
    ]) {
      const res = await POST(
        post('url=private.example', 'application/x-www-form-urlencoded', referer),
      );
      expect(res.headers.get('location'), referer).toBe('/dashboard?notice=host_refused');
    }
  });

  it('the first client an agency adds sends first_client_added beside site_added; its second does not', async () => {
    const p = await person(h.db, 'first-client');
    const agency = await agencyAccount(h.db, p);
    as(p);
    h.chosen = agency.accountId;
    expect((await POST(json({ url: 'first-client.example' }))).status).toBe(201);
    expect(h.capture.mock.calls[0]).toEqual(['site_added', agency.accountId, { n: 1 }]);
    expect(h.agencyCapture.mock.calls).toEqual([['first_client_added', agency.accountId, {}]]);
    h.agencyCapture.mockClear();
    expect((await POST(json({ url: 'second-client.example' }))).status).toBe(201);
    expect(h.agencyCapture).not.toHaveBeenCalled();
  });

  it('a personal account’s first site is not a client: no first_client_added', async () => {
    as(await person(h.db, 'not-agency'));
    expect((await POST(json({ url: 'personal-first.example' }))).status).toBe(201);
    expect(h.capture.mock.calls[0]![2]).toEqual({ n: 1 });
    expect(h.agencyCapture).not.toHaveBeenCalled();
  });

  it('a host the engine does not admit (a private address) is 422, with nothing written or sent', async () => {
    const p = await person(h.db, 'private');
    as(p);
    const res = await POST(json({ url: 'private.example' }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ code: 'host_refused' });
    expect(h.log).toContain('admit private.example');
    expect(await sitesOf(p.accountId)).toEqual([]);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.capture).not.toHaveBeenCalled();
    expect(h.log.filter((l) => l.startsWith('admin.rpc'))).toEqual([]);
  });

  it('what is not a host, or not the body, is 400', async () => {
    as(await person(h.db, 'bad'));
    for (const req of [
      json({ url: 'not a host' }),
      json({ url: '10.0.0.1' }),
      json({ url: 'a.example', accountId: 'x' }),
      json({}),
      post('nope', 'text/plain'),
    ]) {
      expect((await POST(req)).status).toBe(400);
    }
    // A form is sent back to the dashboard with the notice instead.
    const form = await POST(
      post('url=a.example&url=b.example', 'application/x-www-form-urlencoded'),
    );
    expect(form.status).toBe(303);
    expect(form.headers.get('location')).toBe('/dashboard?notice=invalid');
    expect(h.send).not.toHaveBeenCalled();
  });

  it('a refused form goes back to the dashboard with its notice; JSON keeps the body', async () => {
    const p = await person(h.db, 'fullform');
    await keptSite(h.db, p.accountId);
    as(p);
    const res = await POST(post('url=second.example', 'application/x-www-form-urlencoded'));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/dashboard?notice=upgrade_required');
    expect(h.send).not.toHaveBeenCalled();
  });

  it('a Free account’s second site is 402 with the sites gate; nothing sent, no events', async () => {
    const p = await person(h.db, 'full');
    await keptSite(h.db, p.accountId);
    as(p);
    const res = await POST(json({ url: 'second.example' }));
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ code: 'upgrade_required', gate: 'sites' });
    expect(h.send).not.toHaveBeenCalled();
    expect(h.capture).not.toHaveBeenCalled();
  });

  it('a host the account keeps is 409', async () => {
    const p = await person(h.db, 'exists');
    await makePaid(h.db, p.accountId, 'pro');
    const kept = await keptSite(h.db, p.accountId);
    as(p);
    const res = await POST(json({ url: kept.host }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: 'site_exists', siteId: kept.id });
  });

  it('add, remove, add again on Free inside a day is 429 with Retry-After (Q14)', async () => {
    const p = await person(h.db, 'churn');
    as(p);
    const first = (await (await POST(json({ url: 'one.example' }))).json()) as { siteId: string };
    await h.db.query(`update public.sites set removed_at = now() where id = $1`, [first.siteId]);
    h.send.mockClear();
    h.capture.mockClear();
    const res = await POST(json({ url: 'two.example' }));
    expect(res.status).toBe(429);
    const body = (await res.json()) as { code: string; nextAllowedAt: string };
    expect(body).toEqual({ code: 'adds_capped', nextAllowedAt: expect.any(String) });
    const retry = Number(res.headers.get('retry-after'));
    expect(retry).toBeGreaterThan(23 * 3600);
    expect(retry).toBeLessThanOrEqual(24 * 3600);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.capture).not.toHaveBeenCalled();
  });

  it('a developer seat may not add a site (403), and nothing is written', async () => {
    const owner = await person(h.db, 'agency-owner');
    await makePaid(h.db, owner.accountId, 'agency');
    const dev = await person(h.db, 'dev');
    await addSeat(h.db, owner.accountId, dev, 'developer');
    await setDefault(dev, owner.accountId);
    as(dev);
    const res = await POST(json({ url: 'dev.example' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: 'role_refused' });
    expect(await sitesOf(owner.accountId)).toEqual([]);
    expect(h.send).not.toHaveBeenCalled();
  });

  it('a scoped account manager may not add a site (403); an unscoped one adds it on that account', async () => {
    const owner = await person(h.db, 'agency-owner2');
    await makePaid(h.db, owner.accountId, 'agency');
    const client = await keptSite(h.db, owner.accountId);
    const scoped = await person(h.db, 'scoped');
    await addSeat(h.db, owner.accountId, scoped, 'account_manager', [client.id]);
    await setDefault(scoped, owner.accountId);
    as(scoped);
    const refused = await POST(json({ url: 'scoped.example' }));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ code: 'scoped_seat' });

    const manager = await person(h.db, 'manager');
    await addSeat(h.db, owner.accountId, manager, 'account_manager');
    await setDefault(manager, owner.accountId);
    as(manager);
    const ok = await POST(json({ url: 'managed.example' }));
    expect(ok.status).toBe(201);
    const hosts = (await sitesOf(owner.accountId)).map((s) => [s.host, s.schedule_cadence]);
    // Agency: the tier's weekly schedule.
    expect(hosts).toEqual([
      [client.host, null],
      ['managed.example', 'weekly'],
    ]);
  });

  it('a person with two seats adds to the account their switcher names; a forged choice is not followed', async () => {
    const owner = await person(h.db, 'agency-owner3');
    await makePaid(h.db, owner.accountId, 'agency');
    const manager = await person(h.db, 'two-seats');
    await addSeat(h.db, owner.accountId, manager, 'account_manager');
    const other = await person(h.db, 'bystander');
    as(manager);

    h.chosen = owner.accountId;
    expect((await POST(json({ url: 'switched.example' }))).status).toBe(201);
    expect((await sitesOf(owner.accountId)).map((s) => s.host)).toEqual(['switched.example']);
    expect(await sitesOf(manager.accountId)).toEqual([]);

    // Another person's account: no choice, so the default (their own) account takes the site.
    h.chosen = other.accountId;
    expect((await POST(json({ url: 'own.example' }))).status).toBe(201);
    expect((await sitesOf(manager.accountId)).map((s) => s.host)).toEqual(['own.example']);
    expect(await sitesOf(other.accountId)).toEqual([]);
  });

  it('a user on several accounts with no default is 409, writing nothing', async () => {
    const owner = await person(h.db, 'two-accounts');
    const u = await person(h.db, 'both');
    await addSeat(h.db, owner.accountId, u, 'account_manager');
    await h.db.query(`update public.users set default_account_id = null where id = $1`, [u.id]);
    as(u);
    const res = await POST(json({ url: 'which.example' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: 'account_ambiguous' });
    expect(h.log.filter((l) => l.startsWith('admin.rpc'))).toEqual([]);
  });
  it('at the day’s global:audits:day ceiling: 503 capacity, nothing written, nothing sent', async () => {
    const p = await person(h.db, 'ceiling');
    as(p);
    const restore = await setCount(globalSlot(Date.now()), GLOBAL_AUDITS_PER_DAY);
    try {
      const res = await POST(json({ url: 'ceiling.example' }));
      expect([res.status, await res.json()]).toEqual([503, { code: 'capacity' }]);
    } finally {
      await restore();
    }
    expect(await sitesOf(p.accountId)).toEqual([]);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.capture).not.toHaveBeenCalled();
  });

  it('Free: a host whose v1 per-domain bucket is full this hour is 429; a Pro add is not held by it', async () => {
    const restore = await setCount(domainSlot('popular.example', Date.now()), 5);
    try {
      const free = await person(h.db, 'free-domain');
      as(free);
      const res = await POST(json({ url: 'www.popular.example' }));
      expect(res.status).toBe(429);
      expect(await res.json()).toEqual({
        code: 'domain_capped',
        nextAllowedAt: expect.any(String),
      });
      expect(Number(res.headers.get('retry-after'))).toBeLessThanOrEqual(3600);
      expect(await sitesOf(free.accountId)).toEqual([]);
      const pro = await person(h.db, 'pro-domain');
      await makePaid(h.db, pro.accountId, 'pro');
      as(pro);
      expect((await POST(json({ url: 'popular.example' }))).status).toBe(201);
    } finally {
      await restore();
    }
  });
});
