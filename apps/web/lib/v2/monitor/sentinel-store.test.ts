/**
 * Row 23: the sentinel's reads over the service-role client, against a PostgREST stand-in over
 * PGlite with every migration applied. The full check is the engine's recorded site, persisted as
 * the pipeline persists it, so its access tests are the builder's own.
 */
import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { postgrestOver } from '../../../__tests__/helpers/postgrest-pglite';
import { accountOf, doorDb, signUp } from '../../../__tests__/v2/_lib/door-pglite';
import { memoryEvidenceStore } from '../pipeline/test-support/memory-evidence';
import { recordedStoredCheck } from '../pipeline/test-support/stored-check';
import { supabaseSentinelStore } from './sentinel-store';

const LATER = '2099-01-01T00:00:00.000Z';

let db: PGlite;
beforeEach(async () => {
  db = await doorDb();
}, 120_000);
afterEach(async () => {
  await db?.close();
});

const store = () => supabaseSentinelStore(postgrestOver(db));

async function keptRecorded() {
  const c = await recordedStoredCheck(db, memoryEvidenceStore(), LATER);
  const account = await accountOf(db, await signUp(db, 'owner@example.test'));
  await db.query(`update public.sites set account_id = $2 where id = $1`, [c.siteId, account.id]);
  return { ...c, accountId: account.id };
}

describe('watchableSites', () => {
  it('lists a kept, live site with its account row', async () => {
    const c = await keptRecorded();
    const { sites, scanned } = await store().watchableSites(0);
    expect(sites.map((s) => s.siteId)).toEqual([c.siteId]);
    expect(scanned).toBe(1);
    expect(sites[0]!.account.id).toBe(c.accountId);
    expect(sites[0]!.account.state).toBe('free');
    expect(await store().watchableSites(200)).toEqual({ sites: [], scanned: 0 });
    expect((await store().watchableSite(c.siteId))?.siteId).toBe(c.siteId);
  });

  it.each([
    ['removed', `update public.sites set removed_at = now() where id = $1`],
    ['paused', `update public.sites set paused_reason = 'user' where id = $1`],
  ])('leaves out a %s site', async (_, sql) => {
    const c = await keptRecorded();
    await db.query(sql, [c.siteId]);
    expect(await store().watchableSites(0)).toEqual({ sites: [], scanned: 0 });
    expect(await store().watchableSite(c.siteId)).toBeNull();
  });

  it.each([
    ['deleted_at', `deleted_at = now()`],
    [
      'deletion_confirmed_at',
      `deletion_confirmed_at = now(), purge_after = now() + interval '30 days'`,
    ],
  ])('leaves out a site whose account has %s set', async (_, set) => {
    const c = await keptRecorded();
    await db.query(`update public.accounts set ${set} where id = $1`, [c.accountId]);
    // The row is read and counted, so a scan goes on past it; it is not listed.
    expect(await store().watchableSites(0)).toEqual({ sites: [], scanned: 1 });
    expect(await store().watchableSite(c.siteId)).toBeNull();
  });

  it('leaves out a staging site', async () => {
    const c = await keptRecorded();
    const parent = await db.query<{ id: string }>(
      `insert into public.sites (account_id, host) values ($1, 'parent.example') returning id`,
      [c.accountId],
    );
    await db.query(`update public.sites set staging_of_site_id = $2 where id = $1`, [
      c.siteId,
      parent.rows[0]!.id,
    ]);
    expect((await store().watchableSites(0)).sites.map((s) => s.siteId)).toEqual([
      parent.rows[0]!.id,
    ]);
    expect(await store().watchableSite(c.siteId)).toBeNull();
  });

  it('leaves out a site no account keeps', async () => {
    await recordedStoredCheck(db, memoryEvidenceStore(), LATER);
    expect(await store().watchableSites(0)).toEqual({ sites: [], scanned: 0 });
  });
});

describe('baseline', () => {
  it("reads the latest full check's access tests, as the builder made them", async () => {
    const c = await keptRecorded();
    const base = await store().baseline(c.siteId);
    expect(base?.checkId).toBe(c.checkId);
    const key = (t: { identity_role: string; ua: string | null; page_url: string }) =>
      `${t.identity_role} ${t.ua ?? ''} ${t.page_url}`;
    expect(base!.tests.map(key).sort()).toEqual(c.built.access_tests.map(key).sort());
    expect(base!.tests.length).toBeGreaterThan(0);
    const one = c.built.access_tests[0]!;
    expect(base!.tests.find((t) => key(t) === key(one))).toEqual({
      identity_role: one.identity_role,
      ua: one.ua,
      template_key: one.template_key,
      page_url: one.page_url,
      verdict: one.verdict,
      word_count: one.word_count,
    });
  });

  it("reads only the site's own checks and only the named check's tests", async () => {
    const c = await keptRecorded();
    const other = await db.query<{ id: string }>(
      `insert into public.sites (account_id, host) values ($1, 'other.example') returning id`,
      [c.accountId],
    );
    expect(await store().baseline(other.rows[0]!.id)).toBeNull();
    expect(await store().testsOf('c0000000-0000-4000-8000-00000000beef')).toEqual([]);
    expect((await store().testsOf(c.checkId)).length).toBe(c.built.access_tests.length);
  });

  it('has no baseline for a site with no ended check', async () => {
    expect(await store().baseline('c0000000-0000-4000-8000-00000000dead')).toBeNull();
  });
});
