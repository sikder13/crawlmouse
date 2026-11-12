/**
 * CC-31 D2, at the routes: what each person is answered for each of an Agency account's two client
 * sites. The handlers are the routes' own exports. Both Supabase clients are the PostgREST stand-in
 * over PGlite with every migration applied (the session as the caller, so the row policies and the
 * membership functions answer); Inngest, the event capture, the rate limiter and the DNS check are
 * fakes. The same world at the library level: v2-031-scope.test.ts.
 */
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  adminOver,
  scopeWorld,
  sessionOver,
  type ClientSite,
  type ScopeWorld,
} from '../lib/v2/account/sites-test-support';
import { applyAllMigrations, freshDb } from './helpers/pglite-migrations';
import type { Call } from './helpers/postgrest-pglite';

const h = vi.hoisted(() => ({
  db: null as unknown as PGlite,
  user: null as { id: string; email: string } | null,
  /** The requests the caller's session sent. */
  asked: [] as [method: string, ...args: unknown[]][][],
  /** How many service-role clients were made. */
  admins: 0,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => sessionOver(h.db, h.user, h.asked),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    h.admins += 1;
    return adminOver(h.db);
  },
}));
vi.mock('../../../inngest/client', () => ({ inngest: { send: async () => ({ ids: ['x'] }) } }));
vi.mock('@/lib/v2/account/events', async (original) => ({
  ...(await original<typeof import('@/lib/v2/account/events')>()),
  captureFor: () => async () => undefined,
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ allowed: true, remaining: 1, resetAt: new Date(0) }),
}));
vi.mock('@/lib/auth/admit-site', () => ({ admitSiteHost: async () => true }));

import { POST as fixDone } from '@/app/api/fixes/[id]/done/route';
import { POST as fixEmail } from '@/app/api/fixes/[id]/email-developer/route';
import { GET as fixPacket } from '@/app/api/fixes/[id]/packet/route';
import { POST as recheck } from '@/app/api/sites/[id]/checks/route';
import { DELETE as removeSite, PATCH as editSite } from '@/app/api/sites/[id]/route';
import SitePage from '@/app/sites/[id]/page';

const PEOPLE = ['owner', 'manager', 'developer', 'removed', 'stranger'] as const;
type Who = (typeof PEOPLE)[number];
const SITES = ['site1', 'site2'] as const;

const NOT_FOUND = '404 {"code":"not_found"}';
const ROLE_REFUSED = '403 {"code":"role_refused"}';
type Said = '200' | '202' | typeof NOT_FOUND | typeof ROLE_REFUSED;

const ROUTES = [
  'PATCH /api/sites/[id]',
  'DELETE /api/sites/[id]',
  'POST /api/sites/[id]/checks',
  'POST /api/fixes/[id]/done',
  'GET /api/fixes/[id]/packet',
  'POST /api/fixes/[id]/email-developer',
] as const;
type Route = (typeof ROUTES)[number];

/**
 * What a route answers a person, for [site1, site2]. Written by hand from the Guard column of
 * docs/specs/v2/31-agency.md §3: the developer's seat covers site1 only, and a developer may not
 * edit or remove a site.
 */
const EXPECTED: Record<Route, Record<Who, [Said, Said]>> = {
  'PATCH /api/sites/[id]': {
    owner: ['200', '200'],
    manager: ['200', '200'],
    developer: [ROLE_REFUSED, NOT_FOUND],
    removed: [NOT_FOUND, NOT_FOUND],
    stranger: [NOT_FOUND, NOT_FOUND],
  },
  'DELETE /api/sites/[id]': {
    owner: ['200', '200'],
    manager: ['200', '200'],
    developer: [ROLE_REFUSED, NOT_FOUND],
    removed: [NOT_FOUND, NOT_FOUND],
    stranger: [NOT_FOUND, NOT_FOUND],
  },
  'POST /api/sites/[id]/checks': {
    owner: ['202', '202'],
    manager: ['202', '202'],
    developer: ['202', NOT_FOUND],
    removed: [NOT_FOUND, NOT_FOUND],
    stranger: [NOT_FOUND, NOT_FOUND],
  },
  'POST /api/fixes/[id]/done': {
    owner: ['200', '200'],
    manager: ['200', '200'],
    developer: ['200', NOT_FOUND],
    removed: [NOT_FOUND, NOT_FOUND],
    stranger: [NOT_FOUND, NOT_FOUND],
  },
  'GET /api/fixes/[id]/packet': {
    owner: ['200', '200'],
    manager: ['200', '200'],
    developer: ['200', NOT_FOUND],
    removed: [NOT_FOUND, NOT_FOUND],
    stranger: [NOT_FOUND, NOT_FOUND],
  },
  'POST /api/fixes/[id]/email-developer': {
    owner: ['200', '200'],
    manager: ['200', '200'],
    developer: ['200', NOT_FOUND],
    removed: [NOT_FOUND, NOT_FOUND],
    stranger: [NOT_FOUND, NOT_FOUND],
  },
};
/** Whether /sites/[id] renders for [site1, site2], or is a 404. */
const PAGE: Record<Who, [boolean, boolean]> = {
  owner: [true, true],
  manager: [true, true],
  developer: [true, false],
  removed: [false, false],
  stranger: [false, false],
};

const CASES = ROUTES.flatMap((route) =>
  PEOPLE.flatMap((who) =>
    SITES.map((site, i) => [route, who, site, EXPECTED[route][who][i]!] as const),
  ),
);
const PAGE_CASES = PEOPLE.flatMap((who) =>
  SITES.map((site, i) => [who, site, PAGE[who][i]!] as const),
);

const json = (method: string, path: string, body: unknown) =>
  new Request(`https://crawlmouse.com${path}`, {
    method,
    headers: { origin: 'https://crawlmouse.com', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const at = (id: string) => ({ params: Promise.resolve({ id }) });

/** A route's call for one client site: by the site's id, or by its fix's. */
const CALL: Record<Route, (s: ClientSite) => Promise<Response>> = {
  'PATCH /api/sites/[id]': (s) =>
    editSite(json('PATCH', `/api/sites/${s.id}`, { schedule: 'none' }), at(s.id)),
  'DELETE /api/sites/[id]': (s) =>
    removeSite(json('DELETE', `/api/sites/${s.id}`, { confirm: 'remove' }), at(s.id)),
  'POST /api/sites/[id]/checks': (s) =>
    recheck(json('POST', `/api/sites/${s.id}/checks`, {}), at(s.id)),
  'POST /api/fixes/[id]/done': (s) =>
    fixDone(json('POST', `/api/fixes/${s.fix}/done`, {}), at(s.fix)),
  'GET /api/fixes/[id]/packet': (s) =>
    fixPacket(new Request(`https://crawlmouse.com/api/fixes/${s.fix}/packet`), at(s.fix)),
  'POST /api/fixes/[id]/email-developer': (s) =>
    fixEmail(
      json('POST', `/api/fixes/${s.fix}/email-developer`, { email: 'dev@agency.example' }),
      at(s.fix),
    ),
};
/** The one question a route asks before any other read, as the session sends it. */
const GATE: Record<Route, (s: ClientSite) => Call[]> = {
  'PATCH /api/sites/[id]': (s) => [['rpc', 'is_member_for_site', { p_site: s.id }]],
  'DELETE /api/sites/[id]': (s) => [['rpc', 'is_member_for_site', { p_site: s.id }]],
  'POST /api/sites/[id]/checks': (s) => [['rpc', 'is_member_for_site', { p_site: s.id }]],
  'POST /api/fixes/[id]/done': (s) => [['rpc', 'is_member_for_fix', { p_fix: s.fix }]],
  'GET /api/fixes/[id]/packet': (s) => [['rpc', 'is_member_for_fix', { p_fix: s.fix }]],
  'POST /api/fixes/[id]/email-developer': (s) => [['rpc', 'is_member_for_fix', { p_fix: s.fix }]],
};

const said = async (res: Response) =>
  res.ok ? String(res.status) : `${res.status} ${JSON.stringify(await res.json())}`;

let base: PGlite;
let w: ScopeWorld;

beforeAll(async () => {
  base = await freshDb();
  await applyAllMigrations(base);
  w = await scopeWorld(base);
}, 300_000);
afterAll(async () => {
  await base?.close();
});

beforeEach(() => {
  h.db = base;
  h.user = null;
  h.asked.length = 0;
  h.admins = 0;
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  vi.stubEnv('V2_PIPELINE', '1');
  vi.stubEnv('CRAWL_PAUSED', '');
});
afterEach(() => vi.unstubAllEnvs());

const as = (who: Who | null) => {
  h.user = who && { id: w[who].id, email: w[who].email };
};

describe('each route, as each person, for each client site', () => {
  // On a copy of the world each: a removal, a re-check and a mark change it.
  beforeEach(async () => {
    h.db = (await base.clone()) as PGlite;
  });
  afterEach(async () => {
    await h.db.close();
  });

  it.each(CASES)('%s as %s for %s: %s', async (route, who, site, expected) => {
    as(who);
    expect(await said(await CALL[route](w[site]))).toBe(expected);
  });
});

describe('a caller the site is not in scope for is refused by the membership function alone', () => {
  const refused = CASES.filter(([, , , expected]) => expected === NOT_FOUND);

  it('the table holds such cases for each route', () => {
    expect(ROUTES.filter((r) => !refused.some(([route]) => route === r))).toEqual([]);
  });

  it.each(refused)(
    '%s as %s for %s: one question as the caller, and no service-role client',
    async (route, who, site) => {
      as(who);
      await CALL[route](w[site]);
      expect(h.asked).toEqual([GATE[route](w[site])]);
      expect(h.admins).toBe(0);
    },
  );
});

describe('each route signed out', () => {
  it.each(ROUTES)('%s: 401 auth_required, and no service-role client', async (route) => {
    as(null);
    expect(await said(await CALL[route](w.site1))).toBe('401 {"code":"auth_required"}');
    expect(h.admins).toBe(0);
  });
});

describe('/sites/[id], as each person, for each client site', () => {
  const open = (id: string) =>
    SitePage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });

  it.each(PAGE_CASES)('%s opening %s: rendered %s', async (who, site, rendered) => {
    as(who);
    const outcome = await open(w[site].id).then(
      () => 'rendered',
      (e: { digest?: string }) => e.digest ?? Promise.reject(e),
    );
    expect(outcome).toEqual(rendered ? 'rendered' : expect.stringMatching(/404/));
  });

  it('signed out: sent to sign in', async () => {
    as(null);
    await expect(open(w.site1.id)).rejects.toMatchObject({
      digest: expect.stringContaining('/login'),
    });
  });
});
