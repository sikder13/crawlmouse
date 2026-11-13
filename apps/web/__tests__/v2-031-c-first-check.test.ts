/**
 * CC-31 D5: a client with no check yet gets its first one from the matrix's button, which posts to
 * the existing re-check route (`POST /api/sites/[id]/checks`); nothing in the pipeline is changed
 * for it. An Agency trial stores its first client's site row with no check (CC-29 Q5), which is the
 * row this starts from. Run on PGlite with every migration applied, so `is_member_for_site` and
 * `request_capped_check` run for real; Inngest's send and the event capture are fakes.
 *
 * What the route answers for such a site, measured here: it queues the check as a `manual` one, so
 * it counts toward the site's manual checks of the day and is recorded with that trigger, not as a
 * `first_audit`.
 */
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../app/api/sites/[id]/checks/route';
import {
  addSeat,
  adminOver,
  keptSite,
  person,
  sessionOver,
  type Person,
} from '../lib/v2/account/sites-test-support';
import { agencyAccount } from '../lib/v2/agency/test-support';
import { applyAllMigrations, freshDb } from './helpers/pglite-migrations';
import type { Call } from './helpers/postgrest-pglite';

const h = vi.hoisted(() => ({
  db: null as unknown as PGlite,
  user: null as { id: string; email: string } | null,
  admin: 0,
  /** Each request the caller's client sent, as its chain of calls. */
  calls: [] as Call[][],
  send: vi.fn(async (_e: unknown) => undefined),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => sessionOver(h.db, h.user, h.calls),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    h.admin += 1;
    return adminOver(h.db);
  },
}));
vi.mock('../../../inngest/client', () => ({ inngest: { send: h.send } }));
vi.mock('@/lib/v2/account/events', async (original) => ({
  ...(await original<typeof import('@/lib/v2/account/events')>()),
  captureFor: () => async () => undefined,
}));

let owner: Person;
let agencyId: string;
let developer: Person;
let rival: Person;
/** The developer's seat covers `covered` and not `client`. */
let client: string;
let covered: string;

beforeAll(async () => {
  h.db = await freshDb();
  await applyAllMigrations(h.db);
  owner = await person(h.db, 'owner');
  agencyId = (await agencyAccount(h.db, owner)).accountId;
  client = (await keptSite(h.db, agencyId)).id;
  covered = (await keptSite(h.db, agencyId)).id;
  developer = await person(h.db, 'developer');
  await addSeat(h.db, agencyId, developer, 'developer', [covered]);
  // The owner of another agency, with a client of their own.
  rival = await person(h.db, 'rival');
  await keptSite(h.db, (await agencyAccount(h.db, rival, 'Rival Agency')).accountId);
}, 300_000);
afterAll(async () => {
  await h.db?.close();
});

beforeEach(() => {
  h.admin = 0;
  h.calls.length = 0;
  h.send.mockClear();
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  vi.stubEnv('V2_PIPELINE', '1');
  vi.stubEnv('CRAWL_PAUSED', '');
});
afterEach(() => vi.unstubAllEnvs());

/** The matrix's button: an empty form posted to the site's checks route. */
function start(siteId: string, as: Person) {
  h.user = { id: as.id, email: as.email };
  return POST(
    new Request(`https://crawlmouse.com/api/sites/${siteId}/checks`, {
      method: 'POST',
      headers: {
        origin: 'https://crawlmouse.com',
        referer: 'https://crawlmouse.com/agency',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: '',
    }),
    { params: Promise.resolve({ id: siteId }) },
  );
}

const checksOf = async (siteId: string) =>
  (
    await h.db.query<{ status: string; trigger: string }>(
      `select status, trigger from public.checks where site_id = $1`,
      [siteId],
    )
  ).rows;

describe('the first check of a client that has none', () => {
  it('starts from nothing: the client has no check', async () => {
    expect(await checksOf(client)).toEqual([]);
  });

  it('a first check started for a site of another account is a 404, with nothing queued or sent', async () => {
    const res = await start(client, rival);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: 'not_found' });
    expect(await checksOf(client)).toEqual([]);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.admin).toBe(0);
    // Refused by is_member_for_site, asked as the caller: the route reads nothing after it.
    expect(h.calls).toEqual([[['rpc', 'is_member_for_site', { p_site: client }]]]);
  });

  it('a seat that does not cover the client cannot start it either: the same 404', async () => {
    const res = await start(client, developer);
    expect(res.status).toBe(404);
    expect(await checksOf(client)).toEqual([]);
    expect(h.admin).toBe(0);
  });

  it('a seat that covers the client starts it: one check queued, sent once, and the site’s page next', async () => {
    const res = await start(covered, developer);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/sites/${covered}`);
    expect(await checksOf(covered)).toEqual([{ status: 'queued', trigger: 'manual' }]);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send.mock.calls[0]![0]).toMatchObject({
      name: 'check.requested',
      data: { siteId: covered, trigger: 'manual' },
    });
  });

  it('the owner starts the other client’s first check the same way', async () => {
    const res = await start(client, owner);
    expect(res.status).toBe(303);
    expect(await checksOf(client)).toEqual([{ status: 'queued', trigger: 'manual' }]);
  });
});
