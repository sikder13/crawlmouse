import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '@/__tests__/helpers/pglite-migrations';
import { adminOver, keptSite, makePaid, person } from '@/lib/v2/account/sites-test-support';
import { deployHookPath } from '@/lib/v2/account/deploy-hook';

// POST /api/hooks/deploy/[hook] (Goal 1 row 20). The service-role client is the PostgREST stand-in
// over PGlite with every migration applied, so request_capped_check runs for real; Inngest's send
// and the rate limiter are fakes.

const h = vi.hoisted(() => ({
  db: null as unknown as PGlite,
  log: [] as string[],
  send: vi.fn(async (_e: unknown) => undefined),
  ipAllowed: true,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    h.log.push('supabaseAdmin');
    // Each RPC is logged, so a case can tell the route's own refusal from the database's.
    const admin = adminOver(h.db);
    const rpc = admin.rpc.bind(admin);
    return Object.assign(admin, {
      rpc: (fn: string, args?: Record<string, unknown>) => {
        h.log.push(`rpc:${fn}`);
        return rpc(fn, args);
      },
    });
  },
}));
vi.mock('../../../../../../../inngest/client', () => ({ inngest: { send: h.send } }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => {
    h.log.push('rateLimit');
    return { allowed: h.ipAllowed, remaining: 0, resetAt: new Date(Date.now() + 60_000) };
  },
}));

import { POST } from './route';

const SECRET = 'a-test-secret-that-is-at-least-32-characters';

beforeAll(async () => {
  h.db = await freshDb();
  await applyAllMigrations(h.db);
}, 300_000);
afterAll(async () => {
  await h.db?.close();
});
beforeEach(() => {
  h.log.length = 0;
  h.send.mockClear();
  h.ipAllowed = true;
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  vi.stubEnv('V2_PIPELINE', '1');
  vi.stubEnv('CRAWL_PAUSED', '');
  vi.stubEnv('DEPLOY_HOOK_SECRET', SECRET);
});
afterEach(() => vi.unstubAllEnvs());

const hookOf = async (siteId: string) => {
  const { rows } = await h.db.query<{ created_at: Date }>(
    `select created_at from public.sites where id = $1`,
    [siteId],
  );
  return deployHookPath(siteId, rows[0]!.created_at.toISOString(), SECRET).split('/').at(-1)!;
};
const post = (hook: string) =>
  POST(new Request(`https://crawlmouse.com/api/hooks/deploy/${hook}`, { method: 'POST' }), {
    params: Promise.resolve({ hook }),
  });
const answer = async (res: Response) => [res.status, await res.json()] as const;
const deploysOf = async (siteId: string) =>
  (
    await h.db.query<{ trigger: string }>(
      `select trigger from public.checks where site_id = $1 and trigger = 'deploy'`,
      [siteId],
    )
  ).rows.length;

/** A Pro account with a primary site and its staging site. */
async function staged() {
  const p = await person(h.db, 'deploy');
  await makePaid(h.db, p.accountId, 'pro');
  const primary = await keptSite(h.db, p.accountId);
  const staging = await keptSite(h.db, p.accountId, { staging_of_site_id: primary.id });
  return { p, primary, staging };
}

describe('POST /api/hooks/deploy/[hook]', () => {
  it('queues a deploy check of the staging site: 202 with its id, and the pipeline is told', async () => {
    const { staging } = await staged();
    const res = await post(await hookOf(staging.id));
    const [status, body] = await answer(res);
    expect(status).toBe(202);
    expect(body).toMatchObject({ checkId: expect.any(String), created: true });
    expect(await deploysOf(staging.id)).toBe(1);
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it('a second deploy inside the bucket finds the same check, and queues no other', async () => {
    const { staging } = await staged();
    const hook = await hookOf(staging.id);
    const first = (await answer(await post(hook)))[1];
    const [status, again] = await answer(await post(hook));
    expect(status).toBe(202);
    expect(again).toEqual({ checkId: first.checkId, created: false });
    expect(await deploysOf(staging.id)).toBe(1);
  });

  it('a wrong signature is the same 404 as no site, and queues nothing', async () => {
    const { staging } = await staged();
    const hook = await hookOf(staging.id);
    const forged = `${hook.slice(0, -1)}${hook.endsWith('a') ? 'b' : 'a'}`;
    expect(await answer(await post(forged))).toEqual([404, { code: 'not_found' }]);
    expect(await deploysOf(staging.id)).toBe(0);
  });

  it('a site that is not a staging site is a 404, even with its own signature', async () => {
    const { primary } = await staged();
    expect((await post(await hookOf(primary.id))).status).toBe(404);
  });

  it('a removed staging site is a 404', async () => {
    const { staging } = await staged();
    const hook = await hookOf(staging.id);
    await h.db.query(`update public.sites set removed_at = now() where id = $1`, [staging.id]);
    expect((await post(hook)).status).toBe(404);
    // Refused by the route itself, before it asks the database for a check.
    expect(h.log.filter((x) => x.startsWith('rpc:'))).toEqual([]);
  });

  it('an account whose plan has no deploy hooks: 402, nothing queued', async () => {
    // A Free account holding a staging site, as one does after its Pro trial ends.
    const p = await person(h.db, 'deploy-free');
    const primary = await keptSite(h.db, p.accountId);
    const staging = await keptSite(h.db, p.accountId, { staging_of_site_id: primary.id });
    expect(await answer(await post(await hookOf(staging.id)))).toEqual([
      402,
      { code: 'upgrade_required' },
    ]);
    expect(await deploysOf(staging.id)).toBe(0);
  });

  it('with no secret configured: 503 before anything is read', async () => {
    vi.stubEnv('DEPLOY_HOOK_SECRET', '');
    expect(
      await answer(
        await post(`${'1'.repeat(8)}-1111-4111-8111-${'1'.repeat(12)}.${'a'.repeat(32)}`),
      ),
    ).toEqual([503, { code: 'not_configured' }]);
    expect(h.log).toEqual([]);
  });

  it('a malformed address is a 404 before any read', async () => {
    expect((await post('nope')).status).toBe(404);
    expect(h.log).not.toContain('supabaseAdmin');
  });

  it('too many calls from one address: 429 before any read', async () => {
    h.ipAllowed = false;
    const { staging } = await staged();
    expect((await post(await hookOf(staging.id))).status).toBe(429);
    expect(h.log).not.toContain('supabaseAdmin');
  });

  it('with V2_CHECKS_PUBLIC unset: 404 before anything else runs', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    expect((await post('nope')).status).toBe(404);
    expect(h.log).toEqual([]);
  });
});
