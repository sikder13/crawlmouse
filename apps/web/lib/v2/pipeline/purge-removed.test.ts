/**
 * The expiry's third job (CC-GL D2, owner ruling 2026-11-16): `purgeRemoved` deletes the checks,
 * fixes and evidence objects of a kept site removed more than RESTORE_DAYS days ago, and keeps the
 * site row with its `removed_at` and `report_refusals`. On PGlite with every migration and an
 * evidence store in memory, as expire.test.ts runs the other two jobs.
 */
import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { accountOf, count, doorDb, signUp } from '../../../__tests__/v2/_lib/door-pglite';
import { RESTORE_DAYS } from '../copy/restore-window';
import { purgeRemoved, type ExpireDeps } from './expire';
import type { ExpireStore } from './expire-store';
import { claimKeep } from './keep';
import { memoryEvidenceStore } from './test-support/memory-evidence';
import { sqlExpireStore } from './test-support/sql-expire-store';
import { sqlKeepStore } from './test-support/sql-keep-store';
import {
  asService,
  recordedStoredCheck,
  storedCheck,
  storedPaths,
  type StoredCheck,
} from './test-support/stored-check';
import type { EvidenceStore } from './types';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const NOW = Date.now();
const LATER = new Date(NOW + 23 * 60 * MINUTE);
/** Removed this long ago: past the window, and inside it. */
const PAST = new Date(NOW - RESTORE_DAYS * DAY - MINUTE);
const INSIDE = new Date(NOW - RESTORE_DAYS * DAY + MINUTE);
const REFUSALS = [
  { a: 'a'.repeat(64), declined_at: '2026-11-01T00:00:00.000Z', d: 'd'.repeat(64) },
];

let db: PGlite;
let memory: ReturnType<typeof memoryEvidenceStore>;
let n = 0;
const host = () => `purge-${++n}.example`;

beforeEach(async () => {
  db = await doorDb();
  memory = memoryEvidenceStore();
}, 120_000);
afterEach(async () => {
  await db?.close();
});

interface Overrides {
  evidence?: EvidenceStore;
  store?: ExpireStore;
  now?: () => number;
  bounds?: ExpireDeps['bounds'];
  report?: (signal: string, extra: Record<string, unknown>) => void;
}

function depsOf(over: Overrides = {}): ExpireDeps {
  const evidence = over.evidence ?? memory;
  return {
    store: over.store ?? sqlExpireStore(asService(db)),
    evidence,
    keep: {
      store: sqlKeepStore(asService(db)),
      evidence: memory,
      report: over.report ?? (() => {}),
    },
    now: over.now ?? (() => NOW),
    bounds: over.bounds,
  };
}

interface Keeper {
  accountId: string;
  ownerSeatId: string;
}

async function keeper(): Promise<Keeper> {
  const user = await signUp(db, `purge-${++n}@example.com`);
  const account = await accountOf(db, user);
  const { rows } = await db.query<{ id: string }>(
    `select id from public.seats where account_id = $1 and role = 'owner'`,
    [account.id],
  );
  return { accountId: account.id, ownerSeatId: rows[0]!.id };
}

const claim = (check: StoredCheck, who: Keeper) =>
  claimKeep({ store: sqlKeepStore(asService(db)), evidence: memory, report: () => {} }).keep({
    checkId: check.checkId,
    siteId: check.siteId,
    ...who,
    schedule: null,
  });

/** A check of an unkept site, kept by `who`: its objects now under the account's directory. */
async function keptCheck(who: Keeper, check?: StoredCheck): Promise<StoredCheck> {
  const made = check ?? (await storedCheck(db, memory, { host: host(), expiresAt: LATER }));
  expect(await claim(made, who)).toBe('taken');
  return made;
}

/** Another ended check of the same kept site, with objects under the account's directory. */
async function anotherCheck(site: StoredCheck, who: Keeper): Promise<StoredCheck> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.checks (site_id, status, trigger, grade_version, started_at, finished_at,
                                failure_reason, previous_check_id)
     values ($1, 'failed', 'scheduled', '2.0.0', now(), now(), 'persist_failed', $2) returning id`,
    [site.siteId, site.checkId],
  );
  const check: StoredCheck = { siteId: site.siteId, checkId: rows[0]!.id, batches: [0] };
  const path = `${who.accountId}/${site.siteId}/${check.checkId}/batch-0.json.gz`;
  await db.query(
    `insert into public.crawl_batches (check_id, batch, kind, nonce, status, posted_at,
                                       finished_at, result_path)
     values ($1, 0, 'crawl', 'nonce-nonce-nonce-0000', 'done', now(), now(), $2)`,
    [check.checkId, path],
  );
  await memory.put(path, new Uint8Array([1]));
  await memory.put(
    `${who.accountId}/${site.siteId}/${check.checkId}/seeds.json.gz`,
    new Uint8Array([2]),
  );
  return check;
}

/** As the DELETE route removes it, then dated `at`. */
async function removeSite(siteId: string, at: Date): Promise<void> {
  await db.query(`select public.remove_site($1)`, [siteId]);
  await db.query(
    `update public.sites set removed_at = $2 where id = $1 or staging_of_site_id = $1`,
    [siteId, at],
  );
}

const keysUnder = (siteId: string) =>
  [...memory.objects.keys()].filter((k) => k.split('/')[1] === siteId).sort();
const checksOf = (siteId: string) =>
  count(db, `select 1 from public.checks where site_id = $1`, [siteId]);
const siteRow = async (siteId: string) =>
  (
    await db.query<{ removed_at: Date | null; report_refusals: unknown }>(
      `select removed_at, report_refusals from public.sites where id = $1`,
      [siteId],
    )
  ).rows[0];

describe('purgeRemoved', () => {
  it('deletes the checks and every object of a kept site removed past the window; the site row stays with removed_at and report_refusals', async () => {
    const who = await keeper();
    const first = await keptCheck(who);
    const second = await anotherCheck(first, who);
    await db.query(`update public.sites set report_refusals = $2::jsonb where id = $1`, [
      first.siteId,
      JSON.stringify(REFUSALS),
    ]);
    // What a Keep that did not commit leaves under another account, and what a failed move left
    // under anon/.
    const other = await keeper();
    await db.query(`update public.checks set copied_for = $2::uuid[] where id = $1`, [
      first.checkId,
      [other.accountId],
    ]);
    await memory.put(
      `${other.accountId}/${first.siteId}/${first.checkId}/seeds.json.gz`,
      new Uint8Array([3]),
    );
    await memory.put(`anon/${first.siteId}/${first.checkId}/render.json.gz`, new Uint8Array([4]));
    await removeSite(first.siteId, PAST);
    expect(keysUnder(first.siteId).length).toBeGreaterThan(6);

    expect(await purgeRemoved(depsOf())).toEqual({ sites: 1, checks: 2, skipped: 0, left: 0 });
    expect(await checksOf(first.siteId)).toBe(0);
    expect(keysUnder(first.siteId)).toEqual([]);
    expect(await storedPaths(db, second.checkId)).toEqual([]);
    const row = await siteRow(first.siteId);
    expect(row?.removed_at).toEqual(PAST);
    expect(row?.report_refusals).toEqual(REFUSALS);
  });

  it('the window is RESTORE_DAYS: a site removed a minute inside it is untouched, a minute past it is purged', async () => {
    const who = await keeper();
    const inside = await keptCheck(who);
    const past = await keptCheck(who);
    await removeSite(inside.siteId, INSIDE);
    await removeSite(past.siteId, PAST);
    const insideKeys = keysUnder(inside.siteId);

    expect(await purgeRemoved(depsOf())).toEqual({ sites: 1, checks: 1, skipped: 0, left: 0 });
    expect(await checksOf(inside.siteId)).toBe(1);
    expect(keysUnder(inside.siteId)).toEqual(insideKeys);
    expect(await checksOf(past.siteId)).toBe(0);
  });

  it('does not touch a live kept site, an unkept site, or a removed site with a check queued or running', async () => {
    const who = await keeper();
    const live = await keptCheck(who);
    const unkept = await storedCheck(db, memory, { host: host(), expiresAt: LATER });
    const busy = await keptCheck(who);
    await removeSite(busy.siteId, PAST);
    // A check still running when the site was removed (remove_site cancels only queued ones).
    await db.query(
      `insert into public.checks (site_id, status, trigger, grade_version, started_at, progress,
                                  inngest_run_id, heartbeat_at)
       values ($1, 'running', 'scheduled', '2.0.0', now(),
               '{"steps":[],"pages_crawled":0,"pages_estimated":null,"links_found":0,"elapsed_ms":0,"recent_fetches":[]}'::jsonb,
               'run-x', now())`,
      [busy.siteId],
    );
    const before = new Map(memory.objects);

    expect(await purgeRemoved(depsOf())).toEqual({ sites: 0, checks: 0, skipped: 0, left: 0 });
    expect(await checksOf(live.siteId)).toBe(1);
    expect(await checksOf(unkept.siteId)).toBe(1);
    expect(await checksOf(busy.siteId)).toBe(2);
    expect(memory.objects).toEqual(before);
  });

  it('an alert rule that last fired on one of its checks does not stop the delete: the firing is cleared and the rule stays; another rule’s firing is not touched', async () => {
    const who = await keeper();
    const removed = await keptCheck(who);
    const live = await keptCheck(who);
    const rule = async (siteId: string | null, kind: string, fired: string) =>
      (
        await db.query<{ id: string }>(
          `insert into public.alert_rules (account_id, site_id, kind, last_fired_at, last_fired_check_id)
           values ($1, $2, $3, now(), $4) returning id`,
          [who.accountId, siteId, kind, fired],
        )
      ).rows[0]!.id;
    const accountWide = await rule(null, 'any_change', removed.checkId);
    const ofTheSite = await rule(removed.siteId, 'new_orphans', removed.checkId);
    const elsewhere = await rule(live.siteId, 'any_change', live.checkId);
    await removeSite(removed.siteId, PAST);

    expect(await purgeRemoved(depsOf())).toEqual({ sites: 1, checks: 1, skipped: 0, left: 0 });
    const fired = async (id: string) =>
      (
        await db.query<{ at: Date | null; check: string | null }>(
          `select last_fired_at as at, last_fired_check_id as check from public.alert_rules where id = $1`,
          [id],
        )
      ).rows[0];
    expect(await fired(accountWide)).toEqual({ at: null, check: null });
    expect(await fired(ofTheSite)).toEqual({ at: null, check: null });
    expect((await fired(elsewhere))?.check).toBe(live.checkId);
  });

  it('takes every row that names its checks or its fixes, table by table; usage events stay with the check cleared', async () => {
    const who = await keeper();
    const check = await recordedStoredCheck(db, memory, LATER.toISOString());
    expect(await claim(check, who)).toBe('taken');
    const fixId = (
      await db.query<{ id: string }>(
        `select id from public.site_fixes where site_id = $1 limit 1`,
        [check.siteId],
      )
    ).rows[0]!.id;
    await db.query(
      `insert into public.fix_events (fix_id, at, kind, check_id) values ($1, now(), 'verified', $2)`,
      [fixId, check.checkId],
    );
    await db.query(
      `insert into public.changes (site_id, check_id, detected_at, kind, severity, subject, summary,
                                   "where", pages_affected, fix_id)
       values ($1, $2, now(), 'opened', 'bad', 'orphans', 'A page has no link to it', '/', 1, $3)`,
      [check.siteId, check.checkId, fixId],
    );
    await db.query(
      `insert into public.evidence_blobs (check_id, storage_path, version, bytes, sha256)
       values ($1, $2, 1, 1, repeat('0', 64))`,
      [check.checkId, `${who.accountId}/${check.siteId}/${check.checkId}/blob.json.gz`],
    );
    await memory.put(
      `${who.accountId}/${check.siteId}/${check.checkId}/blob.json.gz`,
      new Uint8Array([5]),
    );
    await db.query(
      `insert into public.usage_events (account_id, kind, check_id, result, billable,
                                        compute_seconds, request_count, idempotency_key)
       values ($1, 'check_finished', $2, 'delivered', false, 1, 1, 'purge-cascade-test')`,
      [who.accountId, check.checkId],
    );
    await removeSite(check.siteId, PAST);

    const byCheck = [
      'page_results',
      'link_edges',
      'access_tests',
      'crawl_batches',
      'evidence_blobs',
      'changes',
    ];
    const rows = async () => {
      const counts: Record<string, number> = {};
      for (const t of byCheck) {
        counts[`${t} by check`] = await count(db, `select 1 from public.${t} where check_id = $1`, [
          check.checkId,
        ]);
      }
      for (const t of ['checks', 'site_fixes', 'changes']) {
        counts[`${t} by site`] = await count(db, `select 1 from public.${t} where site_id = $1`, [
          check.siteId,
        ]);
      }
      counts['fix_events by fix'] = await count(
        db,
        `select 1 from public.fix_events where fix_id = $1`,
        [fixId],
      );
      return counts;
    };
    for (const [table, held] of Object.entries(await rows()))
      expect(held, table).toBeGreaterThan(0);

    expect(await purgeRemoved(depsOf())).toEqual({ sites: 1, checks: 1, skipped: 0, left: 0 });
    for (const [table, held] of Object.entries(await rows())) expect(held, table).toBe(0);
    expect(keysUnder(check.siteId)).toEqual([]);
    expect(await count(db, `select 1 from public.sites where id = $1`, [check.siteId])).toBe(1);
    expect(
      await count(
        db,
        `select 1 from public.usage_events where idempotency_key = 'purge-cascade-test' and check_id is null`,
      ),
    ).toBe(1);
  }, 120_000);

  it('reads a site’s checks a page at a time and deletes each page after its objects', async () => {
    const who = await keeper();
    const first = await keptCheck(who);
    const second = await anotherCheck(first, who);
    const third = await anotherCheck(first, who);
    await removeSite(first.siteId, PAST);
    const real = sqlExpireStore(asService(db));
    const order: string[] = [];
    const store: ExpireStore = {
      ...real,
      deleteRemovedChecks: async (siteId, before, ids) => {
        // Each check's objects are gone before its row.
        for (const id of ids) expect(keysUnder(siteId).filter((k) => k.includes(id))).toEqual([]);
        order.push(...ids);
        return real.deleteRemovedChecks(siteId, before, ids);
      },
    };
    expect(
      await purgeRemoved(depsOf({ store, bounds: { batch: 10, maxBatches: 1, checks: 1 } })),
    ).toEqual({
      sites: 1,
      checks: 3,
      skipped: 0,
      left: 0,
    });
    expect([...order].sort()).toEqual([first.checkId, second.checkId, third.checkId].sort());
    expect(await checksOf(first.siteId)).toBe(0);
    expect(keysUnder(first.siteId)).toEqual([]);
  });

  it('a delete that fails after the objects went is counted and reported, and the next run finishes it; a third changes nothing', async () => {
    const who = await keeper();
    const check = await keptCheck(who);
    await removeSite(check.siteId, PAST);
    const real = sqlExpireStore(asService(db));
    const stopped: ExpireStore = {
      ...real,
      deleteRemovedChecks: async () => {
        throw new Error('canceling statement due to statement timeout');
      },
    };
    const reported: string[] = [];
    const report = (signal: string) => reported.push(signal);

    expect(await purgeRemoved(depsOf({ store: stopped, report }))).toEqual({
      sites: 0,
      checks: 0,
      skipped: 1,
      left: 0,
    });
    expect(reported).toEqual(['purge-site-skipped']);
    expect(keysUnder(check.siteId)).toEqual([]);
    expect(await checksOf(check.siteId)).toBe(1);

    expect(await purgeRemoved(depsOf())).toEqual({ sites: 1, checks: 1, skipped: 0, left: 0 });
    expect(await checksOf(check.siteId)).toBe(0);
    expect(await purgeRemoved(depsOf())).toEqual({ sites: 0, checks: 0, skipped: 0, left: 0 });
  });

  it('an object removal that fails leaves the rows, and the next run finishes the site', async () => {
    const who = await keeper();
    const check = await keptCheck(who);
    await removeSite(check.siteId, PAST);
    const failing: EvidenceStore = {
      ...memory,
      remove: async () => {
        throw new Error('storage unavailable');
      },
    };
    expect(await purgeRemoved(depsOf({ evidence: failing }))).toEqual({
      sites: 0,
      checks: 0,
      skipped: 1,
      left: 0,
    });
    expect(await checksOf(check.siteId)).toBe(1);
    expect(keysUnder(check.siteId).length).toBeGreaterThan(0);
    expect(await purgeRemoved(depsOf())).toEqual({ sites: 1, checks: 1, skipped: 0, left: 0 });
    expect(keysUnder(check.siteId)).toEqual([]);
  });

  it('a site that stops qualifying between the read and the delete is not deleted and not counted', async () => {
    const who = await keeper();
    const check = await keptCheck(who);
    await removeSite(check.siteId, PAST);
    const real = sqlExpireStore(asService(db));
    const store: ExpireStore = {
      ...real,
      deleteRemovedChecks: async (...args) => {
        await db.query(`update public.sites set removed_at = now() where id = $1`, [check.siteId]);
        return real.deleteRemovedChecks(...args);
      },
    };
    expect(await purgeRemoved(depsOf({ store }))).toEqual({
      sites: 0,
      checks: 0,
      skipped: 0,
      left: 0,
    });
    expect(await checksOf(check.siteId)).toBe(1);
  });

  it('a staging site removed with its parent is purged too', async () => {
    const who = await keeper();
    const parent = await keptCheck(who);
    const staging = (
      await db.query<{ id: string }>(
        `insert into public.sites (host, account_id, staging_of_site_id) values ($1, $2, $3) returning id`,
        [host(), who.accountId, parent.siteId],
      )
    ).rows[0]!.id;
    await db.query(
      `insert into public.checks (site_id, status, trigger, grade_version, started_at, finished_at, failure_reason)
       values ($1, 'failed', 'scheduled', '2.0.0', now(), now(), 'persist_failed')`,
      [staging],
    );
    await removeSite(parent.siteId, PAST);
    expect(await purgeRemoved(depsOf())).toEqual({ sites: 2, checks: 2, skipped: 0, left: 0 });
    expect(await checksOf(staging)).toBe(0);
    expect(await count(db, `select 1 from public.sites where id = $1`, [staging])).toBe(1);
  });

  it('counts the sites a run did not reach', async () => {
    const who = await keeper();
    for (let i = 0; i < 3; i++) await removeSite((await keptCheck(who)).siteId, PAST);
    expect(await purgeRemoved(depsOf({ bounds: { batch: 1, maxBatches: 2 } }))).toEqual({
      sites: 2,
      checks: 2,
      skipped: 0,
      left: 1,
    });
    expect(await purgeRemoved(depsOf())).toEqual({ sites: 1, checks: 1, skipped: 0, left: 0 });
  });

  it('after the purge, the host added again by the account still starts with the removed row’s report refusals', async () => {
    const who = await keeper();
    const check = await keptCheck(who);
    const { rows } = await db.query<{ host: string }>(
      `select host from public.sites where id = $1`,
      [check.siteId],
    );
    await db.query(`update public.sites set report_refusals = $2::jsonb where id = $1`, [
      check.siteId,
      JSON.stringify(REFUSALS),
    ]);
    await removeSite(check.siteId, PAST);
    await purgeRemoved(depsOf());
    const again = await db.query<{ report_refusals: unknown }>(
      `insert into public.sites (host, account_id) values ($1, $2) returning report_refusals`,
      [rows[0]!.host, who.accountId],
    );
    expect(again.rows[0]!.report_refusals).toEqual(REFUSALS);
  });
});
