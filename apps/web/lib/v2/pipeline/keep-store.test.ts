/**
 * The two KeepStores answer the same calls: production's `supabaseKeepStore` over a PostgREST
 * stand-in that takes each rpc's argument names from the migrated catalog
 * (test-support/postgrest-catalog.ts), and the SQL twin the keep and expiry tests use. Each case
 * states what the rows it wrote should give, so a wrong answer from both is still a failure.
 */
import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { accountOf, anonymousCheck, doorDb, signUp } from '../../../__tests__/v2/_lib/door-pglite';
import { LIVE_OR_GRADED, supabaseKeepStore, type KeepStore } from './keep-store';
import { postgrestWithCatalog } from './test-support/postgrest-catalog';
import { sqlKeepStore } from './test-support/sql-keep-store';
import { asService } from './test-support/stored-check';

const LATER = new Date('2099-01-01T00:00:00Z');
const NO_CHECK = '00000000-0000-4000-8000-000000000000';
const NONCE = 'nonce-nonce-nonce-0000';

describe.each<[string, (db: PGlite) => KeepStore]>([
  ['supabaseKeepStore', (db) => supabaseKeepStore(postgrestWithCatalog(db))],
  ['sqlKeepStore', (db) => sqlKeepStore(asService(db))],
])('%s', (_, make) => {
  let db: PGlite;
  let store: KeepStore;
  let n = 0;
  // The first call migrates the file's template database.
  beforeEach(async () => {
    db = await doorDb();
    store = make(db);
  }, 120_000);
  afterEach(async () => {
    await db?.close();
  });

  async function keeper(): Promise<{ accountId: string; ownerSeatId: string }> {
    const user = await signUp(db, `store-${++n}@example.com`);
    const account = await accountOf(db, user);
    const { rows } = await db.query<{ id: string }>(
      `select id from public.seats where account_id = $1 and role = 'owner'`,
      [account.id],
    );
    return { accountId: account.id, ownerSeatId: rows[0]!.id };
  }
  const batch = (checkId: string, number: number, path: string | null) =>
    db.query(
      `insert into public.crawl_batches (check_id, batch, kind, nonce, status, posted_at,
                                         finished_at, result_path)
       values ($1, $2, 'crawl', $3, 'done', now(), now(), $4)`,
      [checkId, number, NONCE, path],
    );
  const keptSite = async (accountId: string, host: string, removed = false) =>
    (
      await db.query<{ id: string }>(
        `insert into public.sites (host, account_id, removed_at) values ($1, $2, $3) returning id`,
        [host, accountId, removed ? new Date() : null],
      )
    ).rows[0]!.id;

  it('hostKept: true for the account’s own site of that host; false for another account, another host and a removed site', async () => {
    const mine = await keeper();
    const theirs = await keeper();
    await keptSite(mine.accountId, 'kept.example');
    await keptSite(mine.accountId, 'removed.example', true);
    expect(await store.hostKept(mine.accountId, 'kept.example')).toBe(true);
    expect(await store.hostKept(theirs.accountId, 'kept.example')).toBe(false);
    expect(await store.hostKept(mine.accountId, 'other.example')).toBe(false);
    expect(await store.hostKept(mine.accountId, 'removed.example')).toBe(false);
  });

  it('evidenceOf: null for no such check; the status, the keeping account and this check’s batch numbers in order', async () => {
    expect(await store.evidenceOf(NO_CHECK)).toBeNull();
    const a = await anonymousCheck(db, 'a.example', LATER);
    const b = await anonymousCheck(db, 'b.example', LATER);
    for (const number of [2, 0, 1]) await batch(a.checkId, number, null);
    await batch(b.checkId, 7, null);
    expect(await store.evidenceOf(a.checkId)).toEqual({
      status: 'queued',
      accountId: null,
      batches: [0, 1, 2],
    });
    const who = await keeper();
    await db.query(`update public.sites set account_id = $2 where id = $1`, [
      b.siteId,
      who.accountId,
    ]);
    expect(await store.evidenceOf(b.checkId)).toEqual({
      status: 'queued',
      accountId: who.accountId,
      batches: [7],
    });
  });

  it('noteCopy: writes the account on that check’s row and answers true; false for no such check', async () => {
    const who = await keeper();
    const a = await anonymousCheck(db, 'a.example', LATER);
    const b = await anonymousCheck(db, 'b.example', LATER);
    expect(await store.noteCopy(a.checkId, who.accountId)).toBe(true);
    expect(await store.noteCopy(NO_CHECK, who.accountId)).toBe(false);
    const { rows } = await db.query<{ id: string; copied_for: string[] }>(
      `select id, copied_for from public.checks where id = any($1::uuid[])`,
      [[a.checkId, b.checkId]],
    );
    expect(new Map(rows.map((r) => [r.id, r.copied_for]))).toEqual(
      new Map([
        [a.checkId, [who.accountId]],
        [b.checkId, []],
      ]),
    );
  });

  it('keep: takes the site with the seat and the schedule it is given, and rewrites the paths of its pairs', async () => {
    const who = await keeper();
    const { checkId, siteId } = await anonymousCheck(db, 'take.example', LATER);
    const anon = `anon/${siteId}/${checkId}`;
    const mine = `${who.accountId}/${siteId}/${checkId}`;
    await batch(checkId, 0, `${anon}/batch-0.json.gz`);
    await batch(checkId, 1, `${anon}/batch-1.json.gz`);
    expect(
      await store.keep({
        checkId,
        accountId: who.accountId,
        ownerSeatId: who.ownerSeatId,
        schedule: { cadence: 'weekly', iso_weekday: 3, hour_local: 14 },
        pairs: [{ old_path: `${anon}/batch-1.json.gz`, new_path: `${mine}/batch-1.json.gz` }],
      }),
    ).toBe('taken');
    const site = await db.query(
      `select account_id, owner_seat_id, schedule_cadence, schedule_iso_weekday, schedule_hour_local
         from public.sites where id = $1`,
      [siteId],
    );
    expect(site.rows).toEqual([
      {
        account_id: who.accountId,
        owner_seat_id: who.ownerSeatId,
        schedule_cadence: 'weekly',
        schedule_iso_weekday: 3,
        schedule_hour_local: 14,
      },
    ]);
    const paths = await db.query<{ result_path: string }>(
      `select result_path from public.crawl_batches where check_id = $1 order by batch`,
      [checkId],
    );
    expect(paths.rows.map((r) => r.result_path)).toEqual([
      `${anon}/batch-0.json.gz`,
      `${mine}/batch-1.json.gz`,
    ]);
  });

  it('keep: with no schedule and no pair; then not_unowned for another account, expired for a passed check, and a bad pair throws with the database’s code', async () => {
    const who = await keeper();
    const other = await keeper();
    const { checkId, siteId } = await anonymousCheck(db, 'plain.example', LATER);
    const plain = { checkId, ...who, schedule: null, pairs: [] };
    expect(await store.keep(plain)).toBe('taken');
    const site = await db.query(
      `select account_id, schedule_cadence, schedule_iso_weekday, schedule_hour_local
         from public.sites where id = $1`,
      [siteId],
    );
    expect(site.rows).toEqual([
      {
        account_id: who.accountId,
        schedule_cadence: null,
        schedule_iso_weekday: null,
        schedule_hour_local: null,
      },
    ]);
    expect(await store.keep({ ...plain, ...other })).toBe('not_unowned');

    const past = await anonymousCheck(db, 'past.example', new Date(Date.now() - 1000));
    expect(await store.keep({ ...plain, checkId: past.checkId })).toBe('expired');

    const bad = await anonymousCheck(db, 'bad.example', LATER);
    await expect(
      store.keep({
        ...plain,
        checkId: bad.checkId,
        pairs: [{ old_path: 'anon/elsewhere/x.json.gz', new_path: 'anon/elsewhere/x.json.gz' }],
      }),
    ).rejects.toMatchObject({ code: '22023' });
  });

  it('movePaths: answers how many stored paths it rewrote', async () => {
    const who = await keeper();
    const { checkId, siteId } = await anonymousCheck(db, 'move.example', LATER);
    const anon = `anon/${siteId}/${checkId}`;
    const mine = `${who.accountId}/${siteId}/${checkId}`;
    await batch(checkId, 0, `${anon}/batch-0.json.gz`);
    await db.query(`update public.checks set map_path = $2 where id = $1`, [
      checkId,
      `${anon}/map.json.gz`,
    ]);
    await db.query(`update public.sites set account_id = $2 where id = $1`, [
      siteId,
      who.accountId,
    ]);
    const pairs = ['batch-0', 'map', 'seeds'].map((name) => ({
      old_path: `${anon}/${name}.json.gz`,
      new_path: `${mine}/${name}.json.gz`,
    }));
    expect(await store.movePaths(checkId, who.accountId, pairs)).toBe(2);
    expect(await store.movePaths(checkId, who.accountId, pairs)).toBe(0);
    expect(await store.movePaths(checkId, who.accountId, [])).toBe(0);
  });

  it('hasLiveOrGradedCheck: true for a site with a check in one of those statuses; false for a failed check and for another site’s', async () => {
    expect(LIVE_OR_GRADED).toEqual(['queued', 'running', 'deferred', 'finished', 'partial']);
    const queued = await anonymousCheck(db, 'queued.example', LATER);
    const failed = await anonymousCheck(db, 'failed.example', LATER);
    await db.query(
      `update public.checks set status = 'failed', failure_reason = 'persist_failed',
              started_at = now(), finished_at = now() where id = $1`,
      [failed.checkId],
    );
    const deferred = await anonymousCheck(db, 'deferred.example', LATER);
    await db.query(
      `update public.checks set status = 'deferred', deferred_until = now() + interval '1 hour'
        where id = $1`,
      [deferred.checkId],
    );
    expect(await store.hasLiveOrGradedCheck(queued.siteId)).toBe(true);
    expect(await store.hasLiveOrGradedCheck(deferred.siteId)).toBe(true);
    expect(await store.hasLiveOrGradedCheck(failed.siteId)).toBe(false);
  });
});

describe('the stand-in refuses what PostgREST refuses', () => {
  it('an argument name the function does not declare, or one left out, is PGRST202', async () => {
    const db = await doorDb();
    try {
      const sb = postgrestWithCatalog(db);
      expect(
        await sb.rpc('note_check_copy', { p_check: NO_CHECK, p_acct: NO_CHECK }),
      ).toMatchObject({ data: null, error: { code: 'PGRST202' } });
      expect(await sb.rpc('note_check_copy', { p_check: NO_CHECK })).toMatchObject({
        error: { code: 'PGRST202' },
      });
      expect(await sb.rpc('note_check_copy', { p_check: NO_CHECK, p_account: NO_CHECK })).toEqual({
        data: false,
        error: null,
      });
    } finally {
      await db.close();
    }
  }, 120_000);
});
