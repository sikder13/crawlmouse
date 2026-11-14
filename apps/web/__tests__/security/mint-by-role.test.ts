/**
 * Minting a v2 public report, role by role (CC-37 Q16): `POST /api/reports/mint` with `{checkId}`,
 * the route's own export, on PGlite with every migration applied. The session client is the
 * PostgREST stand-in as the caller, so `is_member_for_site` and `seat_may(…, 'mint_report')` answer
 * from SQL; the service role is the stand-in without one. The rate limit and the event capture are
 * fakes. Owners and account managers publish a client; a developer may not; a seat that does not
 * cover the site, another account's member and a signed-out caller learn nothing of it.
 */
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '../helpers/pglite-migrations';
import type { Call } from '../helpers/postgrest-pglite';
import {
  addSeat,
  adminOver,
  person,
  scopeWorld,
  sessionOver,
  type Person,
  type ScopeWorld,
} from '../../lib/v2/account/sites-test-support';

const h = vi.hoisted(() => ({
  db: null as unknown as PGlite,
  user: null as { id: string; email: string } | null,
  /** Requests the caller's session sent, one list per client made. */
  asked: [] as [method: string, ...args: unknown[]][][],
  /** The service-role clients' requests. */
  admin: [] as Call[][],
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => sessionOver(h.db, h.user, h.asked),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => adminOver(h.db, h.admin) }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ allowed: true, remaining: 1, resetAt: new Date(0) }),
}));
vi.mock('@/lib/analytics-server', () => ({ captureServerEvent: async () => undefined }));

import { POST as mint } from '@/app/api/reports/mint/route';

type Who = 'owner' | 'manager' | 'developer' | 'developer2' | 'stranger' | 'anonymous';
const OK = 200;
const REFUSED = '403 {"error":"role_refused"}';
const NOT_FOUND = '404 {"error":"not_found"}';
const SIGNED_OUT = '401 {"error":"auth_required"}';

/** What each person is answered for [site1, site2]. Written by hand from D5 and Guard (spec 31 §3). */
const EXPECTED: Record<Who, [number | string, number | string]> = {
  owner: [OK, OK],
  manager: [OK, OK],
  developer: [REFUSED, NOT_FOUND],
  developer2: [NOT_FOUND, REFUSED],
  stranger: [NOT_FOUND, NOT_FOUND],
  anonymous: [SIGNED_OUT, SIGNED_OUT],
};
const CASES = (Object.keys(EXPECTED) as Who[]).flatMap((who) =>
  (['site1', 'site2'] as const).map((site, i) => [who, site, EXPECTED[who][i]!] as const),
);

let base: PGlite;
let w: ScopeWorld;
let developer2: Person;

beforeAll(async () => {
  base = await freshDb();
  await applyAllMigrations(base);
  w = await scopeWorld(base);
  developer2 = await person(base, 'developer2');
  await addSeat(base, w.accountId, developer2, 'developer', [w.site2.id]);
}, 300_000);
afterAll(async () => {
  await base?.close();
});
beforeEach(async () => {
  h.db = (await base.clone()) as PGlite;
  h.asked.length = 0;
  h.admin.length = 0;
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await h.db.close();
});

const personOf = (who: Who): Person | null =>
  who === 'anonymous' ? null : who === 'developer2' ? developer2 : w[who];

async function said(who: Who, checkId: string): Promise<number | string> {
  const p = personOf(who);
  h.user = p && { id: p.id, email: p.email };
  const res = await mint(
    new Request('https://crawlmouse.com/api/reports/mint', {
      method: 'POST',
      headers: { origin: 'https://crawlmouse.com', 'content-type': 'application/json' },
      body: JSON.stringify({ checkId }),
    }),
  );
  return res.status === OK ? OK : `${res.status} ${JSON.stringify(await res.json())}`;
}

describe('POST /api/reports/mint {checkId}, as each person, for each client site', () => {
  it.each(CASES)('mint as %s for %s: %s', async (who, site, expected) => {
    expect(await said(who, w[site].check)).toBe(expected);
  });

  it('a developer whose seat covers the site is refused before any service-role read, and nothing is minted', async () => {
    expect(await said('developer', w.site1.check)).toBe(REFUSED);
    expect(h.admin.flat()).toEqual([]);
    const { rows } = await h.db.query('select 1 from public.public_reports where check_id = $1', [
      w.site1.check,
    ]);
    expect(rows).toEqual([]);
  });

  it('the role is asked through the caller’s session, for the site’s own account', async () => {
    await said('developer', w.site1.check);
    expect(h.asked.flat()).toContainEqual([
      'rpc',
      'seat_may',
      { p_account: w.accountId, p_action: 'mint_report' },
    ]);
  });
});
