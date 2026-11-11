import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { postgrestOver } from '../../../../__tests__/helpers/postgrest-pglite';
import { count, doorDb, signUp, accountOf } from '../../../../__tests__/v2/_lib/door-pglite';
import { sqlStartStore } from './start-store-sql';
import { supabaseStartStore, type StartStore } from './start-store';

const SITE = '5a0e6f0c-3d55-4c58-8a5e-0d1b2c3d4e5f';
const CHECK = '6b1f7a1d-4e66-4d69-9b6f-1e2c3d4e5f60';

const queueCheck = (db: PGlite) =>
  db.query(
    `insert into public.checks (id, site_id, status, trigger, grade_version)
     values ($1, $2, 'queued', 'first_audit', '1.0.0')`,
    [CHECK, SITE],
  );

// The two implementations answer the same calls: production's over a PostgREST stand-in, and the
// SQL twin the start's PGlite tests use.
describe.each<[string, (db: PGlite) => StartStore]>([
  ['supabaseStartStore', (db) => supabaseStartStore(postgrestOver(db))],
  ['sqlStartStore', (db) => sqlStartStore(db)],
])('%s', (_, make) => {
  let db: PGlite;
  let store: StartStore;
  beforeEach(async () => {
    db = await doorDb();
    store = make(db);
    // The first call applies each migration to the template database; later calls clone it.
  }, 120_000);

  it('inserts a site no account keeps, under the id it is given', async () => {
    await store.insertUnkeptSite(SITE, 'example.com');
    const { rows } = await db.query(
      `select id, host, account_id, removed_at from public.sites where id = $1`,
      [SITE],
    );
    expect(rows).toEqual([{ id: SITE, host: 'example.com', account_id: null, removed_at: null }]);
  });

  it('a second insert under the same id changes nothing', async () => {
    await store.insertUnkeptSite(SITE, 'example.com');
    await store.insertUnkeptSite(SITE, 'other.example');
    const { rows } = await db.query(`select host from public.sites where id = $1`, [SITE]);
    expect(rows).toEqual([{ host: 'example.com' }]);
    expect(await count(db, 'select 1 from public.sites')).toBe(1);
  });

  it('reads neither row before a start', async () => {
    expect(await store.derived(SITE, CHECK)).toEqual({ checkStatus: null, siteKept: false });
  });

  it('reads the site without its check, then both', async () => {
    await store.insertUnkeptSite(SITE, 'example.com');
    expect(await store.derived(SITE, CHECK)).toEqual({ checkStatus: null, siteKept: false });
    await queueCheck(db);
    expect(await store.derived(SITE, CHECK)).toEqual({ checkStatus: 'queued', siteKept: false });
  });

  it('reads a site an account has taken as kept', async () => {
    await store.insertUnkeptSite(SITE, 'example.com');
    await queueCheck(db);
    const account = await accountOf(db, await signUp(db, 'owner@example.org'));
    await db.query(`update public.sites set account_id = $2 where id = $1`, [SITE, account.id]);
    expect(await store.derived(SITE, CHECK)).toEqual({ checkStatus: 'queued', siteKept: true });
    await db.query(`select public.fail_check($1::uuid, 'canceled', null)`, [CHECK]);
    expect(await store.derived(SITE, CHECK)).toEqual({ checkStatus: 'failed', siteKept: true });
  });
});
