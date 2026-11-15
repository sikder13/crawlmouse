/**
 * What an audit page reads of a kept check, role by role (CC-37 D1 review r1): `readAudit`, the read
 * the nine `/audit/[id]/<tab>` pages make through `ReadyPage`, on PGlite with every migration applied.
 * The session client is the PostgREST stand-in as the caller, so `is_member_for_site` answers from SQL;
 * the service role is the stand-in without one. A kept check is the account's: a visitor holding its
 * id, a member of another account, a removed seat and a developer whose seat covers the other client
 * read nothing of it; a seat that covers its site reads it.
 */
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '../helpers/pglite-migrations';
import {
  adminOver,
  scopeWorld,
  sessionOver,
  type Person,
  type ScopeWorld,
} from '../../lib/v2/account/sites-test-support';

const h = vi.hoisted(() => ({
  db: null as unknown as PGlite,
  user: null as { id: string; email: string } | null,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => sessionOver(h.db, h.user) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => adminOver(h.db) }));

import { readAudit } from '@/app/audit/[id]/_lib/access';

let w: ScopeWorld;

beforeAll(async () => {
  h.db = await freshDb();
  await applyAllMigrations(h.db);
  w = await scopeWorld(h.db);
}, 300_000);
afterAll(async () => {
  await h.db?.close();
});

type Who = 'visitor' | 'stranger' | 'removed' | 'developer' | 'owner' | 'manager';
const personOf = (who: Who): Person | null => (who === 'visitor' ? null : w[who]);

async function reads(who: Who, site: 'site1' | 'site2') {
  const p = personOf(who);
  h.user = p && { id: p.id, email: p.email };
  return (await readAudit(w[site].check)) !== null;
}

describe('readAudit of a kept check, as each person', () => {
  it('a visitor holding the id, another account’s member, a removed seat and a developer on the other client read nothing', async () => {
    expect(await reads('visitor', 'site1')).toBe(false);
    expect(await reads('stranger', 'site1')).toBe(false);
    expect(await reads('removed', 'site1')).toBe(false);
    expect(await reads('developer', 'site2')).toBe(false);
  });

  it('a seat that covers the site reads it (the case above is not vacuous)', async () => {
    expect(await reads('developer', 'site1')).toBe(true);
    expect(await reads('owner', 'site2')).toBe(true);
    expect(await reads('manager', 'site1')).toBe(true);
  });
});
