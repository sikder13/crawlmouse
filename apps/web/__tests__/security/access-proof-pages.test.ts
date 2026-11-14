/**
 * Proofs for the access matrix's v2 account pages whose scope no page-level test covered (CC-37
 * D1): each page's own export, read as each person of `scopeWorld` plus a developer whose seat covers
 * the second client, on PGlite with every migration applied. The session client is the PostgREST
 * stand-in as the caller, so row security and `sitesInScope` decide what is read; the service role
 * is the stand-in without one. What a person must not see is checked over the whole element tree the
 * page returns (its props at any depth), so a site's host or id reaching a screen in any field fails.
 */
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '../helpers/pglite-migrations';
import {
  addSeat,
  adminOver,
  person,
  scopeWorld,
  sessionOver,
  type ClientSite,
  type Person,
  type ScopeWorld,
} from '../../lib/v2/account/sites-test-support';
import { agencyAccount } from '../../lib/v2/agency/test-support';

const h = vi.hoisted(() => ({
  db: null as unknown as PGlite,
  user: null as { id: string; email: string } | null,
  chosen: null as string | null,
}));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'cm_account' && h.chosen !== null ? { name, value: h.chosen } : undefined,
  }),
  headers: async () => new Headers({ 'x-crawlmouse-v2-rewrite': '1' }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error('redirect'), { digest: `NEXT_REDIRECT;${to}` });
  },
  notFound: () => {
    throw Object.assign(new Error('not found'), { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  },
}));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => sessionOver(h.db, h.user) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => adminOver(h.db) }));

import AgencyTrialPage from '@/app/agency-trial/page';
import AlertsPage from '@/app/alerts/page';
import ChangesPage from '@/app/changes/page';
import DashboardPage from '@/app/dashboard/v2/page';
import SeatsPage from '@/app/seats/page';

let w: ScopeWorld;
let developer2: Person;
/** An Agency account the world's owner owns, with the manager and the developer seated on it. */
let agency: string;

beforeAll(async () => {
  h.db = await freshDb();
  await applyAllMigrations(h.db);
  w = await scopeWorld(h.db);
  developer2 = await person(h.db, 'developer2');
  await addSeat(h.db, w.accountId, developer2, 'developer', [w.site2.id]);
  agency = (await agencyAccount(h.db, w.owner)).accountId;
  await addSeat(h.db, agency, w.manager, 'account_manager');
  await addSeat(h.db, agency, w.developer, 'developer');
}, 300_000);
afterAll(async () => {
  await h.db?.close();
});
afterEach(() => {
  vi.unstubAllEnvs();
  h.user = null;
  h.chosen = null;
});

/** Every string in the value, at any depth (element props included); functions are skipped. */
function strings(v: unknown, out: string[] = [], seen = new Set<unknown>()): string[] {
  if (typeof v === 'string') out.push(v);
  else if (v && typeof v === 'object' && !seen.has(v)) {
    seen.add(v);
    for (const x of Object.values(v)) strings(x, out, seen);
  }
  return out;
}
const marks = (s: ClientSite) => [s.host, s.id, s.check];
const holds = (all: string[], s: ClientSite) =>
  marks(s).some((m) => all.some((x) => x.includes(m)));

type Open = () => Promise<unknown>;
const PAGES: Record<string, Open> = {
  '/dashboard/v2': () => DashboardPage({ searchParams: Promise.resolve({}) } as never),
  '/alerts': () => AlertsPage({ searchParams: Promise.resolve({}) } as never),
  '/changes': () => ChangesPage({ searchParams: Promise.resolve({}) } as never),
  '/seats': () => SeatsPage({ searchParams: Promise.resolve({}) } as never),
  '/agency-trial': () => AgencyTrialPage({ searchParams: Promise.resolve({}) }),
};

async function read(page: string, p: Person | null) {
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  vi.stubEnv('V2_BILLING', '1');
  h.user = p && { id: p.id, email: p.email };
  h.chosen = w.accountId;
  return PAGES[page]!().then(
    (el) => ({ rendered: true as const, all: strings(el) }),
    (e: { digest?: string }) => {
      if (!e.digest) throw e;
      return { rendered: false as const, digest: e.digest, all: [] as string[] };
    },
  );
}

/** What each person sees of the two clients on a page that lists them: [site1, site2]. */
const SEES: Record<string, [boolean, boolean]> = {
  developer: [true, false],
  developer2: [false, true],
  stranger: [false, false],
};

/** The cases of one page: each person, what they see, and the signed-out redirect. */
function byPerson(page: string) {
  const people = () =>
    [
      ['developer', w.developer],
      ['developer2', developer2],
      ['stranger', w.stranger],
    ] as const;

  it('a developer sees the client their seat covers alone, and a stranger neither', async () => {
    for (const [who, p] of people()) {
      const r = await read(page, p);
      expect(r.rendered, `${page} ${who}`).toBe(true);
      expect([holds(r.all, w.site1), holds(r.all, w.site2)], `${page} ${who}`).toEqual(SEES[who]);
    }
  });

  it('the owner and the account manager see the account’s clients (the case above is not vacuous)', async () => {
    for (const p of [w.owner, w.manager]) {
      const r = await read(page, p);
      expect(holds(r.all, w.site1) || holds(r.all, w.site2), page).toBe(true);
    }
  });

  it('signed out: sent to sign in, nothing read', async () => {
    const r = await read(page, null);
    expect(r.rendered ? 'rendered' : r.digest).toMatch(/NEXT_REDIRECT;\/login/);
  });
}

describe('/dashboard/v2, read as each person', () => byPerson('/dashboard/v2'));
describe('/alerts, read as each person', () => byPerson('/alerts'));
describe('/changes, read as each person', () => byPerson('/changes'));
describe('/seats, read as each person', () => byPerson('/seats'));

describe('/agency-trial, read as each person', () => {
  // The page offers billing on the Agency accounts the person owns, so the Agency account's id
  // appears in the owner's view (Manage billing, Cancel) and in no other person's, though the
  // manager and the developer hold seats on it.
  const named = (all: string[]) => all.some((x) => x.includes(agency));

  it('the owner is offered the account’s billing; a manager, the developers and a stranger are not', async () => {
    expect(named((await read('/agency-trial', w.owner)).all)).toBe(true);
    for (const p of [w.manager, w.developer, developer2, w.stranger]) {
      const r = await read('/agency-trial', p);
      expect(r.rendered).toBe(true);
      expect(named(r.all), p.email).toBe(false);
    }
  });

  it('signed out: sent to sign in', async () => {
    const r = await read('/agency-trial', null);
    expect(r.rendered ? 'rendered' : r.digest).toMatch(/NEXT_REDIRECT;\/login/);
  });
});
