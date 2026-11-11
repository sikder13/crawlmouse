/**
 * The two ExpireStores answer the same calls: production's `supabaseExpireStore` over a PostgREST
 * stand-in that takes each rpc's argument names and return shape from the migrated catalog
 * (test-support/postgrest-catalog.ts), and the SQL twin the expiry tests use. Each case states what
 * the rows it wrote should give.
 */
import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  accountOf,
  anonymousCheck,
  count,
  doorDb,
  signUp,
} from '../../../__tests__/v2/_lib/door-pglite';
import { supabaseExpireStore, type ExpireStore } from './expire-store';
import { postgrestWithCatalog } from './test-support/postgrest-catalog';
import { sqlExpireStore } from './test-support/sql-expire-store';
import { asService } from './test-support/stored-check';

const HOUR = 60 * 60 * 1000;
const NOW = Date.now();
const CUTOFF = new Date(NOW - HOUR).toISOString();
const BARE_BEFORE = new Date(NOW - 25 * HOUR).toISOString();
const EXPIRED = new Date(NOW - 2 * HOUR);
const NONCE = 'nonce-nonce-nonce-0000';

describe.each<[string, (db: PGlite) => ExpireStore]>([
  ['supabaseExpireStore', (db) => supabaseExpireStore(postgrestWithCatalog(db))],
  ['sqlExpireStore', (db) => sqlExpireStore(asService(db))],
])('%s', (_, make) => {
  let db: PGlite;
  let store: ExpireStore;
  let n = 0;
  // The first call migrates the file's template database.
  beforeEach(async () => {
    db = await doorDb();
    store = make(db);
  }, 120_000);
  afterEach(async () => {
    await db?.close();
  });

  const accountId = async () => (await accountOf(db, await signUp(db, `x-${++n}@example.com`))).id;
  const batch = (checkId: string, number: number, path: string | null = null) =>
    db.query(
      `insert into public.crawl_batches (check_id, batch, kind, nonce, status, posted_at,
                                         finished_at, result_path)
       values ($1, $2, 'crawl', $3, 'done', now(), now(), $4)`,
      [checkId, number, NONCE, path],
    );
  const end = (checkId: string) =>
    db.query(
      `update public.checks set status = 'failed', failure_reason = 'persist_failed',
              started_at = now(), finished_at = now() where id = $1`,
      [checkId],
    );

  it('expiredUnkept: each due site in id order with its checks, their batch numbers and copied_for; a site with no check has none', async () => {
    const copier = await accountId();
    const withCheck = await anonymousCheck(db, 'due.example', EXPIRED);
    await end(withCheck.checkId);
    for (const number of [1, 0]) await batch(withCheck.checkId, number);
    await db.query(`update public.checks set copied_for = $2::uuid[] where id = $1`, [
      withCheck.checkId,
      [copier],
    ]);
    const bare = await db.query<{ id: string }>(
      `insert into public.sites (host, created_at) values ('bare.example', $1) returning id`,
      [new Date(NOW - 30 * HOUR)],
    );
    // Not due: an unexpired check, and a kept site whose check has a passed expiry.
    await anonymousCheck(db, 'fresh.example', new Date(NOW + HOUR));
    const kept = await anonymousCheck(db, 'kept.example', EXPIRED);
    await db.query(`update public.sites set account_id = $2 where id = $1`, [kept.siteId, copier]);

    const expected = [
      {
        siteId: withCheck.siteId,
        checks: [{ checkId: withCheck.checkId, batches: [0, 1], copiedFor: [copier] }],
      },
      { siteId: bare.rows[0]!.id, checks: [] },
    ].sort((a, b) => (a.siteId < b.siteId ? -1 : 1));
    expect(await store.expiredUnkept(CUTOFF, BARE_BEFORE, null, 10)).toEqual({
      rows: expected,
      remaining: 2,
    });
    // One site a page: the second page starts after the first's id, and counts what is left.
    expect(await store.expiredUnkept(CUTOFF, BARE_BEFORE, null, 1)).toEqual({
      rows: [expected[0]],
      remaining: 2,
    });
    expect(await store.expiredUnkept(CUTOFF, BARE_BEFORE, expected[0]!.siteId, 1)).toEqual({
      rows: [expected[1]],
      remaining: 1,
    });
    expect(await store.expiredUnkept(CUTOFF, BARE_BEFORE, expected[1]!.siteId, 1)).toEqual({
      rows: [],
      remaining: 0,
    });
  });

  it('deleteExpiredUnkept: deletes the due sites among those named and answers their ids; no site named, no delete', async () => {
    const due = [
      await anonymousCheck(db, 'one.example', EXPIRED),
      await anonymousCheck(db, 'two.example', EXPIRED),
    ];
    for (const d of due) await end(d.checkId);
    const fresh = await anonymousCheck(db, 'fresh.example', new Date(NOW + HOUR));
    const unnamed = await anonymousCheck(db, 'unnamed.example', EXPIRED);
    await end(unnamed.checkId);

    expect(await store.deleteExpiredUnkept([], CUTOFF, BARE_BEFORE)).toEqual([]);
    expect(await count(db, 'select 1 from public.sites')).toBe(4);
    const deleted = await store.deleteExpiredUnkept(
      [due[0]!.siteId, due[1]!.siteId, fresh.siteId],
      CUTOFF,
      BARE_BEFORE,
    );
    expect([...deleted].sort()).toEqual([due[0]!.siteId, due[1]!.siteId].sort());
    const left = await db.query<{ id: string }>(`select id from public.sites`);
    expect(left.rows.map((r) => r.id).sort()).toEqual([fresh.siteId, unnamed.siteId].sort());
  });

  it('unsettledKept: an ended check of a kept site with a path under anon/, with its site, account, batch numbers and strays', async () => {
    const keeper = await accountId();
    const stray = await accountId();
    const made = [
      await anonymousCheck(db, 'a.example', null),
      await anonymousCheck(db, 'b.example', null),
    ].sort((a, b) => (a.checkId < b.checkId ? -1 : 1));
    for (const [i, m] of made.entries()) {
      await end(m.checkId);
      await batch(m.checkId, 4 + i, `anon/${m.siteId}/${m.checkId}/batch-${4 + i}.json.gz`);
      // Kept long ago, so only the stored path lists it.
      await db.query(
        `update public.sites set account_id = $2, updated_at = now() - interval '30 days' where id = $1`,
        [m.siteId, keeper],
      );
    }
    await db.query(`update public.checks set copied_for = $2::uuid[] where id = $1`, [
      made[0]!.checkId,
      [stray],
    ]);
    // Not listed: an ended check of an unkept site with the same kind of path.
    const unkept = await anonymousCheck(db, 'unkept.example', null);
    await end(unkept.checkId);
    await batch(unkept.checkId, 0, `anon/${unkept.siteId}/${unkept.checkId}/batch-0.json.gz`);

    const since = new Date(NOW - 72 * HOUR).toISOString();
    const expected = made.map((m, i) => ({
      checkId: m.checkId,
      siteId: m.siteId,
      accountId: keeper,
      batches: [4 + i],
      strays: i === 0 ? [stray] : [],
    }));
    expect(await store.unsettledKept(since, null, 10)).toEqual({ rows: expected, remaining: 2 });
    expect(await store.unsettledKept(since, expected[0]!.checkId, 1)).toEqual({
      rows: [expected[1]],
      remaining: 1,
    });
  });
});
