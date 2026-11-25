import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '@/__tests__/helpers/pglite-migrations';
import {
  addSeat,
  adminOver,
  makePaid,
  person,
  sessionOver,
  type Person,
} from '@/lib/v2/account/sites-test-support';

// Goal 1 row 25: POST and DELETE /api/agency/domain and POST /api/agency/domain/check, over PGlite
// with every migration applied: the session client is the caller's (row security), the admin client
// the service role's. The TXT lookup and Vercel's API are replaced at their boundaries (node:dns,
// fetch); the rate limit is a counter.

const h = vi.hoisted(() => ({
  db: null as unknown as PGlite,
  user: null as { id: string; email: string } | null,
  txt: {} as Record<string, string[][]>,
  vercel: [] as string[],
  buckets: new Map<string, number>(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => sessionOver(h.db, h.user) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => adminOver(h.db) }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async (key: string, limit: number) => {
    const n = (h.buckets.get(key) ?? 0) + 1;
    h.buckets.set(key, n);
    return { allowed: n <= limit, remaining: 0, resetAt: new Date() };
  },
}));
vi.mock('node:dns/promises', () => ({
  resolveTxt: async (name: string) => {
    if (!(name in h.txt)) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
    return h.txt[name];
  },
}));

const HOST = 'reports.agency-example.com';

beforeAll(async () => {
  h.db = await freshDb();
  await applyAllMigrations(h.db);
}, 300_000);
afterAll(async () => h.db?.close());
beforeEach(() => {
  vi.stubEnv('V2_ACCOUNT_DOOR', '1');
  h.user = null;
  h.txt = {};
  h.vercel = [];
  h.buckets.clear();
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const u = new URL(url);
    h.vercel.push(`${init.method} ${u.pathname}`);
    if (u.pathname.endsWith('/config')) {
      return Response.json({
        misconfigured: false,
        recommendedCNAME: [{ rank: 1, value: 'abc.vercel-dns-017.com.' }],
      });
    }
    return Response.json({ name: HOST, verified: true, verification: [] });
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const as = (p: Person | null) => {
  h.user = p && { id: p.id, email: p.email };
};

async function agency(): Promise<Person> {
  const owner = await person(h.db, 'owner');
  await makePaid(h.db, owner.accountId, 'agency');
  await h.db.query(
    `insert into public.agency_brands (account_id, agency_name) values ($1, 'Agency')`,
    [owner.accountId],
  );
  return owner;
}

const route = () => import('./route');
const check = () => import('./check/route');
const at = (account: string, path = '') =>
  `https://crawlmouse.com/api/agency/domain${path}?account=${account}`;
const claim = async (account: string, host: unknown) =>
  (await route()).POST(
    new Request(at(account), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ host }),
    }),
  );
const checkNow = async (account: string) =>
  (await check()).POST(new Request(at(account, '/check'), { method: 'POST' }));
const remove = async (account: string) =>
  (await route()).DELETE(
    new Request(at(account), { method: 'DELETE', headers: { 'content-type': 'application/json' } }),
  );

const row = async (account: string) =>
  (
    await h.db.query<Record<string, unknown>>(
      `select portal_domain, portal_domain_status, portal_txt_token, portal_txt_verified_at,
              portal_cname_found, portal_certificate_issued_at, vercel_domain_added_at
         from public.agency_brands where account_id = $1`,
      [account],
    )
  ).rows[0];

describe('who may set an agency’s portal host (row 25)', () => {
  it('is a 404 with agency_domain hidden, before the session is read', async () => {
    const owner = await agency();
    as(owner);
    vi.stubEnv('V2_HIDE_FEATURES', 'agency_domain');
    for (const res of [
      await claim(owner.accountId, HOST),
      await checkNow(owner.accountId),
      await remove(owner.accountId),
    ]) {
      expect(res.status).toBe(404);
    }
    expect((await row(owner.accountId))?.portal_domain).toBeNull();
  });

  it('is a 401 signed out', async () => {
    const owner = await agency();
    expect((await claim(owner.accountId, HOST)).status).toBe(401);
  });

  it('answers an account the caller is not a member of exactly as a developer seat, so it says nothing about the account', async () => {
    const owner = await agency();
    const [dev, stranger] = [await person(h.db, 'dev'), await person(h.db, 'stranger')];
    await addSeat(h.db, owner.accountId, dev, 'developer');
    as(dev);
    const devRes = await claim(owner.accountId, HOST);
    as(stranger);
    const strangerRes = await claim(owner.accountId, HOST);
    expect([devRes.status, strangerRes.status]).toEqual([403, 403]);
    expect(await strangerRes.json()).toEqual(await devRes.json());
    expect((await row(owner.accountId))?.portal_domain).toBeNull();
  });

  it('lets an account manager set it, and refuses a Pro account', async () => {
    const owner = await agency();
    const manager = await person(h.db, 'manager');
    await addSeat(h.db, owner.accountId, manager, 'account_manager');
    as(manager);
    expect((await claim(owner.accountId, 'reports.manager-example.com')).status).toBe(200);

    const pro = await person(h.db, 'pro');
    await makePaid(h.db, pro.accountId, 'pro');
    as(pro);
    const res = await claim(pro.accountId, 'reports.pro-example.com');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'upgrade_required' });
  });
});

describe('claim, check and remove, end to end over the table (row 25 b)', () => {
  it('stores the host, then attaches it only once its TXT record proves control', async () => {
    vi.stubEnv('VERCEL_DOMAINS_TOKEN', 'test-token');
    const owner = await agency();
    as(owner);
    const claimed = await claim(owner.accountId, HOST);
    expect(claimed.status).toBe(200);
    expect(claimed.headers.get('cache-control')).toBe('no-store');
    const { domain } = (await claimed.json()) as {
      domain: { txt: { name: string; value: string } };
    };
    expect(domain.txt.name).toBe(`_crawlmouse.${HOST}`);
    expect(await row(owner.accountId)).toMatchObject({
      portal_domain: HOST,
      portal_domain_status: 'unverified',
      portal_cname_found: false,
    });

    // No record yet: nothing is attached.
    expect(await (await checkNow(owner.accountId)).json()).toMatchObject({
      domain: { status: 'unverified' },
    });
    expect(h.vercel).toEqual([]);

    h.txt[domain.txt.name] = [[domain.txt.value]];
    expect(await (await checkNow(owner.accountId)).json()).toMatchObject({
      domain: { status: 'verified', cname: 'abc.vercel-dns-017.com' },
    });
    expect(h.vercel.map((c) => c.split(' ')[0])).toEqual(['POST', 'GET']);
    expect(await row(owner.accountId)).toMatchObject({
      portal_domain_status: 'verified',
      portal_cname_found: true,
    });

    expect((await remove(owner.accountId)).status).toBe(200);
    expect(h.vercel.at(-1)).toMatch(
      /^DELETE \/v9\/projects\/.+\/domains\/reports\.agency-example\.com$/,
    );
    expect(await row(owner.accountId)).toMatchObject({
      portal_domain: null,
      portal_domain_status: 'unverified',
      portal_txt_token: null,
      portal_cname_found: null,
      vercel_domain_added_at: null,
    });
  });

  it('without the owner’s token, check is a 503 that reads and writes nothing', async () => {
    const owner = await agency();
    as(owner);
    await claim(owner.accountId, HOST);
    const before = await row(owner.accountId);
    h.txt[`_crawlmouse.${HOST}`] = [[`crawlmouse-verify=${before!.portal_txt_token as string}`]];
    const res = await checkNow(owner.accountId);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'domain_service_unconfigured' });
    expect(await row(owner.accountId)).toEqual(before);
    expect(h.vercel).toEqual([]);
  });

  it('refuses a host another account holds, pending or verified', async () => {
    const [a, b] = [await agency(), await agency()];
    as(a);
    expect((await claim(a.accountId, 'shared.agency-example.com')).status).toBe(200);
    as(b);
    const res = await claim(b.accountId, 'SHARED.agency-example.com.');
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'in_use' });
    expect((await row(b.accountId))?.portal_domain).toBeNull();
  });

  it('refuses a host the rules refuse, with the rule, and a body that names none', async () => {
    const owner = await agency();
    as(owner);
    for (const [host, reason] of [
      ['app.crawlmouse.com', 'ours'],
      ['x.vercel.app', 'unknown_suffix'],
      ['192.168.0.1', 'ip'],
      ['agency-example.com', 'apex'],
      ['intranet', 'single_label'],
    ]) {
      const res = await claim(owner.accountId, host);
      expect(res.status, host).toBe(400);
      expect(await res.json(), host).toEqual({ code: 'invalid_host', reason });
    }
    expect((await claim(owner.accountId, 42)).status).toBe(400);
    expect((await row(owner.accountId))?.portal_domain).toBeNull();
  });
});
