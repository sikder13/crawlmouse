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

// PATCH, DELETE and POST (`_method`) /api/sites/[id] (CC-26b D6). The session and service-role clients
// are the PostgREST stand-in over PGlite with every migration applied, so membership, roles, row
// security and edit_site / remove_site run for real; the engine's DNS check is a fake.

const h = vi.hoisted(() => ({
  log: [] as string[],
  db: null as unknown as PGlite,
  user: null as { id: string; email: string } | null,
  refused: new Set<string>(),
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
vi.mock('@/lib/auth/admit-site', () => ({
  admitSiteHost: async (host: string) => {
    h.log.push(`admit ${host}`);
    return !h.refused.has(host);
  },
}));

import { DELETE, PATCH, POST } from './route';

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
  h.refused = new Set(['private.example']);
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
});
afterEach(() => vi.unstubAllEnvs());

const as = (p: Person | null) => {
  h.user = p && { id: p.id, email: p.email };
};

type Handler = typeof PATCH;

function send(handler: Handler, method: string, id: string, body?: unknown, form = false) {
  const headers: Record<string, string> = { origin: 'https://crawlmouse.com' };
  let text: string | undefined;
  if (body !== undefined) {
    headers['content-type'] = form ? 'application/x-www-form-urlencoded' : 'application/json';
    text = form
      ? new URLSearchParams(body as Record<string, string>).toString()
      : JSON.stringify(body);
  }
  return handler(
    new Request(`https://crawlmouse.com/api/sites/${id}`, { method, headers, body: text }),
    { params: Promise.resolve({ id }) },
  );
}

const patch = (id: string, body: unknown) => send(PATCH, 'PATCH', id, body);
const del = (id: string) => send(DELETE, 'DELETE', id);

async function siteRow(id: string) {
  return (
    await h.db.query<{
      schedule_cadence: string | null;
      schedule_iso_weekday: number | null;
      schedule_hour_local: number | null;
      competitor_hosts: string[];
      removed_at: Date | null;
    }>(
      `select schedule_cadence, schedule_iso_weekday, schedule_hour_local, competitor_hosts, removed_at
         from public.sites where id = $1`,
      [id],
    )
  ).rows[0]!;
}

const stagingOf = async (id: string) =>
  (
    await h.db.query<{ host: string }>(
      `select host from public.sites where staging_of_site_id = $1 and removed_at is null`,
      [id],
    )
  ).rows.map((r) => r.host);

describe('/api/sites/[id] guards', () => {
  it('with V2_CHECKS_PUBLIC unset: each method is 404 before anything else runs', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    const p = await person(h.db, 'off');
    const s = await keptSite(h.db, p.accountId);
    as(p);
    for (const res of [
      await patch(s.id, { schedule: 'none' }),
      await del(s.id),
      await send(POST, 'POST', s.id, { _method: 'DELETE' }, true),
    ]) {
      expect([res.status, await res.json()]).toEqual([404, { code: 'not_found' }]);
    }
    expect(h.log).toEqual([]);
    expect((await siteRow(s.id)).removed_at).toBeNull();
  });

  it('signed out: 401, and no service-role client', async () => {
    for (const res of [await patch(randomUUID(), { schedule: 'none' }), await del(randomUUID())]) {
      expect([res.status, await res.json()]).toEqual([401, { code: 'auth_required' }]);
    }
    expect(h.log).not.toContain('supabaseAdmin');
  });

  it('a stranger, a malformed id and an unknown id are the same 404, with no service-role client', async () => {
    const owner = await person(h.db, 'owner');
    const s = await keptSite(h.db, owner.accountId);
    as(await person(h.db, 'stranger'));
    for (const id of [s.id, 'nope', randomUUID()]) {
      for (const res of [await patch(id, { schedule: 'none' }), await del(id)]) {
        expect([res.status, await res.json()], id).toEqual([404, { code: 'not_found' }]);
      }
    }
    expect(h.log).not.toContain('supabaseAdmin');
    expect((await siteRow(s.id)).removed_at).toBeNull();
  });

  it('a developer seat may not edit or remove (403); nothing changes', async () => {
    const owner = await person(h.db, 'agency');
    await makePaid(h.db, owner.accountId, 'agency');
    const s = await keptSite(h.db, owner.accountId);
    const dev = await person(h.db, 'dev');
    await addSeat(h.db, owner.accountId, dev, 'developer');
    as(dev);
    for (const res of [await patch(s.id, { competitorHosts: ['a.example'] }), await del(s.id)]) {
      expect([res.status, await res.json()]).toEqual([403, { code: 'role_refused' }]);
    }
    expect(await siteRow(s.id)).toMatchObject({ competitor_hosts: [], removed_at: null });
    expect(h.log).not.toContain('supabaseAdmin');
  });

  it('a scoped manager edits a site in scope; a site outside it is 404', async () => {
    const owner = await person(h.db, 'agency2');
    await makePaid(h.db, owner.accountId, 'agency');
    const mine = await keptSite(h.db, owner.accountId);
    const other = await keptSite(h.db, owner.accountId);
    const manager = await person(h.db, 'scoped');
    await addSeat(h.db, owner.accountId, manager, 'account_manager', [mine.id]);
    as(manager);
    expect((await patch(mine.id, { competitorHosts: ['a.example'] })).status).toBe(200);
    expect((await patch(other.id, { competitorHosts: ['a.example'] })).status).toBe(404);
    expect((await del(other.id)).status).toBe(404);
    expect(await siteRow(other.id)).toMatchObject({ competitor_hosts: [], removed_at: null });
  });

  it('a removed site is 404 to every method', async () => {
    const p = await person(h.db, 'removed');
    const s = await keptSite(h.db, p.accountId, { removed_at: new Date().toISOString() });
    as(p);
    expect((await patch(s.id, { schedule: 'none' })).status).toBe(404);
    expect((await del(s.id)).status).toBe(404);
  });
});

describe('PATCH /api/sites/[id]', () => {
  it('the owner sets a monthly schedule on Free, and clears it', async () => {
    const p = await person(h.db, 'monthly');
    const s = await keptSite(h.db, p.accountId);
    as(p);
    const res = await patch(s.id, { schedule: 'monthly', dow: 4, hour: 7 });
    expect([res.status, await res.json()]).toEqual([200, { stagingSiteId: null }]);
    expect(await siteRow(s.id)).toMatchObject({
      schedule_cadence: 'monthly',
      schedule_iso_weekday: 4,
      schedule_hour_local: 7,
    });
    expect((await patch(s.id, { schedule: 'none' })).status).toBe(200);
    expect((await siteRow(s.id)).schedule_cadence).toBeNull();
  });

  it('Free: a weekly schedule, a competitor and a staging URL are each 402 with the gate’s name', async () => {
    const p = await person(h.db, 'free-gates');
    const s = await keptSite(h.db, p.accountId);
    as(p);
    for (const [body, gate] of [
      [{ schedule: 'weekly', dow: 1, hour: 6 }, 'schedule'],
      [{ competitorHosts: ['rival.example'] }, 'competitorsPerSite'],
      [{ stagingUrl: 'staging.example' }, 'stagingAndDeployHooks'],
    ] as const) {
      const res = await patch(s.id, body);
      expect([res.status, await res.json()], gate).toEqual([
        402,
        { code: 'upgrade_required', gate },
      ]);
    }
    expect(await siteRow(s.id)).toMatchObject({ schedule_cadence: null, competitor_hosts: [] });
    expect(await stagingOf(s.id)).toEqual([]);
    expect(h.log.filter((l) => l.startsWith('admit'))).toEqual([]);
  });

  it('a user on a Free and a Pro account gets each account’s own gates (R3)', async () => {
    const u = await person(h.db, 'both');
    const proOwner = await person(h.db, 'pro-owner');
    await makePaid(h.db, proOwner.accountId, 'pro');
    await addSeat(h.db, proOwner.accountId, u, 'account_manager');
    await h.db.query(`update public.users set default_account_id = $2 where id = $1`, [
      u.id,
      proOwner.accountId,
    ]);
    const freeSite = await keptSite(h.db, u.accountId);
    const proSite = await keptSite(h.db, proOwner.accountId);
    as(u);
    const weekly = { schedule: 'weekly', dow: 2, hour: 8 };
    expect((await patch(freeSite.id, weekly)).status).toBe(402);
    expect((await patch(proSite.id, weekly)).status).toBe(200);
    expect((await siteRow(proSite.id)).schedule_cadence).toBe('weekly');
  });

  it('Pro: competitors up to the account’s limit, canonicalised; one over is 402', async () => {
    const p = await person(h.db, 'pro');
    await makePaid(h.db, p.accountId, 'pro');
    const s = await keptSite(h.db, p.accountId);
    as(p);
    expect((await patch(s.id, { competitorHosts: ['https://Rival.example/'] })).status).toBe(200);
    expect((await siteRow(s.id)).competitor_hosts).toEqual(['rival.example']);
    const over = await patch(s.id, { competitorHosts: ['a.example', 'b.example'] });
    expect([over.status, await over.json()]).toEqual([
      402,
      { code: 'upgrade_required', gate: 'competitorsPerSite' },
    ]);
    expect((await siteRow(s.id)).competitor_hosts).toEqual(['rival.example']);
  });

  it('Pro: a staging URL makes a staging site that holds no slot, and an empty one clears it', async () => {
    const p = await person(h.db, 'staging');
    await makePaid(h.db, p.accountId, 'pro');
    const s = await keptSite(h.db, p.accountId);
    as(p);
    const res = await patch(s.id, { stagingUrl: 'https://staging.shop.example' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stagingSiteId: expect.any(String) });
    expect(await stagingOf(s.id)).toEqual(['staging.shop.example']);
    const cleared = await send(POST, 'POST', s.id, { _method: 'PATCH', stagingUrl: '' }, true);
    expect([cleared.status, cleared.headers.get('location')]).toEqual([303, `/sites/${s.id}`]);
    expect(await stagingOf(s.id)).toEqual([]);
  });

  it('a private competitor or staging host is 422, and nothing is written', async () => {
    const p = await person(h.db, 'private');
    await makePaid(h.db, p.accountId, 'agency');
    const s = await keptSite(h.db, p.accountId);
    as(p);
    for (const [body, field] of [
      [{ competitorHosts: ['private.example'] }, 'competitorHosts'],
      [{ stagingUrl: 'private.example' }, 'stagingUrl'],
    ] as const) {
      const res = await patch(s.id, body);
      expect([res.status, await res.json()]).toEqual([422, { code: 'host_refused', field }]);
    }
    expect(h.log).toContain('admit private.example');
    expect((await siteRow(s.id)).competitor_hosts).toEqual([]);
    expect(await stagingOf(s.id)).toEqual([]);
  });

  it('a staging host the account already keeps is 409', async () => {
    const p = await person(h.db, 'taken');
    await makePaid(h.db, p.accountId, 'pro');
    const s = await keptSite(h.db, p.accountId);
    const other = await keptSite(h.db, p.accountId);
    as(p);
    const res = await patch(s.id, { stagingUrl: other.host });
    expect([res.status, await res.json()]).toEqual([
      409,
      { code: 'site_exists', field: 'stagingUrl' },
    ]);
  });

  it('a staging site takes no competitors (409)', async () => {
    const p = await person(h.db, 'child');
    await makePaid(h.db, p.accountId, 'agency');
    const s = await keptSite(h.db, p.accountId);
    const child = await keptSite(h.db, p.accountId, { staging_of_site_id: s.id });
    as(p);
    const res = await patch(child.id, { competitorHosts: ['a.example'] });
    expect([res.status, await res.json()]).toEqual([409, { code: 'staging_site' }]);
  });

  it('a body that is not the edit body is 400', async () => {
    const p = await person(h.db, 'bad');
    const s = await keptSite(h.db, p.accountId);
    as(p);
    for (const body of [{}, { host: 'x.example' }, { schedule: 'weekly' }, { schedule: 'daily' }]) {
      expect((await patch(s.id, body)).status, JSON.stringify(body)).toBe(400);
    }
    const noBody = await send(PATCH, 'PATCH', s.id);
    expect(noBody.status).toBe(400);
  });
});

describe('DELETE /api/sites/[id]', () => {
  it('the owner removes the site: removed_at set, history kept, its staging site removed too', async () => {
    const p = await person(h.db, 'remove');
    const s = await keptSite(h.db, p.accountId);
    const child = await keptSite(h.db, p.accountId, { staging_of_site_id: s.id });
    await h.db.query(
      `insert into public.checks (id, site_id, status, trigger, grade_version, queued_at, started_at,
                                  finished_at, failure_reason)
       values (gen_random_uuid(), $1, 'failed', 'manual', '2.0.0', now(), now(), now(), 'internal')`,
      [s.id],
    );
    as(p);
    const res = await del(s.id);
    expect([res.status, await res.json()]).toEqual([200, { removed: true }]);
    expect((await siteRow(s.id)).removed_at).not.toBeNull();
    expect((await siteRow(child.id)).removed_at).not.toBeNull();
    const { rows } = await h.db.query(`select 1 from public.checks where site_id = $1`, [s.id]);
    expect(rows).toHaveLength(1);
    expect((await del(s.id)).status).toBe(404);
  });

  it('a form posts DELETE as POST with _method and is sent to the dashboard', async () => {
    const p = await person(h.db, 'form-remove');
    const s = await keptSite(h.db, p.accountId);
    as(p);
    const res = await send(POST, 'POST', s.id, { _method: 'delete' }, true);
    expect([res.status, res.headers.get('location')]).toEqual([303, '/dashboard']);
    expect((await siteRow(s.id)).removed_at).not.toBeNull();
  });

  it('POST without a PATCH or DELETE _method is 405', async () => {
    const p = await person(h.db, 'post');
    const s = await keptSite(h.db, p.accountId);
    as(p);
    for (const body of [{ _method: 'PUT' }, { schedule: 'none' }]) {
      expect((await send(POST, 'POST', s.id, body, true)).status).toBe(405);
    }
    expect((await send(POST, 'POST', s.id, { _method: 'DELETE' })).status).toBe(405);
    expect((await siteRow(s.id)).removed_at).toBeNull();
  });
});
