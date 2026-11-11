/**
 * The daily expiry (CC-22b D8) on PGlite with every migration and an evidence store in memory:
 * `expireUnkept` deletes the sites no account keeps once their checks have expired, with their
 * objects, and `settleKept` moves what kept checks still hold under `anon/`. Stores run each call
 * as one service-role transaction.
 */
import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { accountOf, count, doorDb, signUp } from '../../../__tests__/v2/_lib/door-pglite';
import type { EvidenceDirectory } from './evidence';
import {
  EXPIRY_BATCH_SITES,
  EXPIRY_GRACE_MS,
  EXPIRY_MAX_BATCHES,
  expireUnkept,
  SETTLE_SWEEP_MS,
  settleKept,
  STEP_BUDGET_MS,
  type ExpireDeps,
} from './expire';
import type { ExpireStore } from './expire-store';
import { claimKeep } from './keep';
import { ANONYMOUS_EXPIRY_HOURS } from './limits';
import { memoryEvidenceStore } from './test-support/memory-evidence';
import { sqlExpireStore } from './test-support/sql-expire-store';
import { sqlKeepStore } from './test-support/sql-keep-store';
import {
  anonOwner,
  asService,
  objectBytes,
  recordedStoredCheck,
  siteAccount,
  storedCheck,
  storedPaths,
  type StoredCheck,
} from './test-support/stored-check';
import { evidencePath, type EvidenceName, type EvidenceStore } from './types';

type Memory = ReturnType<typeof memoryEvidenceStore>;
type Evidence = EvidenceStore & EvidenceDirectory;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
/** The run's clock: the real one when the file loads, so `keep_check`'s `now()` is after it. */
const NOW = Date.now();
/** Expired beyond the grace. */
const EXPIRED = new Date(NOW - EXPIRY_GRACE_MS - MINUTE);
const LATER = new Date(NOW + 23 * HOUR);

let db: PGlite;
let memory: Memory;
let n = 0;
const host = () => `expiry-${++n}.example`;

// A database of its own for each test: each asserts on everything a run deleted.
beforeEach(async () => {
  db = await doorDb();
  memory = memoryEvidenceStore();
}, 120_000);
afterEach(async () => {
  await db?.close();
});

interface Overrides {
  evidence?: Evidence;
  store?: ExpireStore;
  now?: () => number;
  bounds?: ExpireDeps['bounds'];
}

function depsOf(over: Overrides = {}): ExpireDeps {
  const evidence = over.evidence ?? memory;
  return {
    store: over.store ?? sqlExpireStore(asService(db)),
    evidence,
    keep: { store: sqlKeepStore(asService(db)), evidence, report: () => {} },
    now: over.now ?? (() => NOW),
    bounds: over.bounds,
  };
}

async function keeper(): Promise<{ accountId: string; ownerSeatId: string }> {
  const user = await signUp(db, `expiry-${++n}@example.com`);
  const account = await accountOf(db, user);
  const { rows } = await db.query<{ id: string }>(
    `select id from public.seats where account_id = $1 and role = 'owner'`,
    [account.id],
  );
  return { accountId: account.id, ownerSeatId: rows[0]!.id };
}

const exists = (table: 'sites' | 'checks', id: string) =>
  count(db, `select 1 from public.${table} where id = $1`, [id]);

const anonKeys = (check: StoredCheck) =>
  [...memory.objects.keys()].filter((k) => k.startsWith(`anon/${check.siteId}/`)).sort();

describe('expireUnkept', () => {
  it('deletes an expired unkept site with its check, its batches and each of its objects', async () => {
    const check = await storedCheck(db, memory, { host: host(), expiresAt: EXPIRED });
    expect(anonKeys(check)).toHaveLength(5);
    expect(await expireUnkept(depsOf())).toEqual({ sites: 1, checks: 1, skipped: 0, left: 0 });
    expect(await exists('sites', check.siteId)).toBe(0);
    expect(await exists('checks', check.checkId)).toBe(0);
    expect(
      await count(db, `select 1 from public.crawl_batches where check_id = $1`, [check.checkId]),
    ).toBe(0);
    expect([...memory.objects.keys()]).toEqual([]);
  });

  it('a check that failed after build leaves no object: built and map are named from the owner, not from a row', async () => {
    const check = await storedCheck(db, memory, {
      host: host(),
      expiresAt: EXPIRED,
      built: true,
    });
    // As a persist failure leaves it: the map object written, map_path never set.
    await db.query(`update public.checks set map_path = null where id = $1`, [check.checkId]);
    expect(anonKeys(check)).toContain(evidencePath(anonOwner(check), 'built'));
    expect(anonKeys(check)).toContain(evidencePath(anonOwner(check), 'map'));
    await expireUnkept(depsOf());
    expect([...memory.objects.keys()]).toEqual([]);
  });

  it('does not touch a kept site, even one whose check still carries a passed expiry', async () => {
    const check = await storedCheck(db, memory, { host: host(), expiresAt: EXPIRED });
    const who = await keeper();
    // A claim that stopped between its two writes (the flag-off claim): the site is kept, the
    // check's expires_at was never cleared.
    await db.query(`update public.sites set account_id = $2 where id = $1`, [
      check.siteId,
      who.accountId,
    ]);
    const before = new Map(memory.objects);
    expect(await expireUnkept(depsOf())).toEqual({ sites: 0, checks: 0, skipped: 0, left: 0 });
    expect(await exists('sites', check.siteId)).toBe(1);
    expect(await exists('checks', check.checkId)).toBe(1);
    expect(memory.objects).toEqual(before);
  });

  it('does not touch an unexpired check, one inside the grace, or one still queued or running', async () => {
    const kept = [
      await storedCheck(db, memory, { host: host(), expiresAt: LATER }),
      await storedCheck(db, memory, {
        host: host(),
        expiresAt: new Date(NOW - EXPIRY_GRACE_MS + MINUTE),
      }),
      await storedCheck(db, memory, { host: host(), expiresAt: EXPIRED, status: 'queued' }),
      await storedCheck(db, memory, { host: host(), expiresAt: EXPIRED, status: 'running' }),
    ];
    const before = new Map(memory.objects);
    expect(await expireUnkept(depsOf())).toEqual({ sites: 0, checks: 0, skipped: 0, left: 0 });
    for (const check of kept) expect(await exists('checks', check.checkId)).toBe(1);
    expect(memory.objects).toEqual(before);
  });

  it('a site with an expired check and an unexpired one stays whole', async () => {
    const check = await storedCheck(db, memory, { host: host(), expiresAt: EXPIRED });
    await db.query(
      `insert into public.checks (site_id, status, trigger, grade_version, expires_at)
       values ($1, 'queued', 'first_audit', '2.0.0', $2)`,
      [check.siteId, LATER],
    );
    await db.query(
      `update public.checks set status = 'deferred', deferred_until = now()
                     where site_id = $1 and status = 'queued'`,
      [check.siteId],
    );
    const before = new Map(memory.objects);
    expect((await expireUnkept(depsOf())).sites).toBe(0);
    expect(await exists('checks', check.checkId)).toBe(1);
    expect(memory.objects).toEqual(before);
  });

  it('deletes an unkept site with no check once it is older than an audit’s life, and not before', async () => {
    const life = ANONYMOUS_EXPIRY_HOURS * HOUR + EXPIRY_GRACE_MS;
    const bare = async (createdAt: Date) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into public.sites (host, created_at) values ($1, $2) returning id`,
        [host(), createdAt],
      );
      return rows[0]!.id;
    };
    const old = await bare(new Date(NOW - life - MINUTE));
    const fresh = await bare(new Date(NOW - life + MINUTE));
    expect(await expireUnkept(depsOf())).toEqual({ sites: 1, checks: 0, skipped: 0, left: 0 });
    expect(await exists('sites', old)).toBe(0);
    expect(await exists('sites', fresh)).toBe(1);
  });

  it('a run stopped after the objects were removed is finished by the next; a third changes nothing', async () => {
    const check = await storedCheck(db, memory, { host: host(), expiresAt: EXPIRED });
    const real = sqlExpireStore(asService(db));
    const stopped: ExpireStore = {
      ...real,
      deleteExpiredUnkept: async () => {
        throw new Error('the step was stopped');
      },
    };
    await expect(expireUnkept(depsOf({ store: stopped }))).rejects.toThrow('the step was stopped');
    expect([...memory.objects.keys()]).toEqual([]);
    expect(await exists('checks', check.checkId)).toBe(1);

    expect(await expireUnkept(depsOf())).toEqual({ sites: 1, checks: 1, skipped: 0, left: 0 });
    expect(await exists('sites', check.siteId)).toBe(0);
    expect(await expireUnkept(depsOf())).toEqual({ sites: 0, checks: 0, skipped: 0, left: 0 });
  });

  it('a site whose objects cannot be removed is skipped with its rows, and the others go', async () => {
    const stuck = await storedCheck(db, memory, { host: host(), expiresAt: EXPIRED });
    const gone = await storedCheck(db, memory, { host: host(), expiresAt: EXPIRED });
    const evidence: Evidence = {
      ...memory,
      remove: async (paths) => {
        if (paths.some((p) => p.includes(stuck.checkId)))
          throw new Error('storage: remove refused');
        return memory.remove(paths);
      },
    };
    expect(await expireUnkept(depsOf({ evidence }))).toEqual({
      sites: 1,
      checks: 1,
      skipped: 1,
      left: 0,
    });
    expect(await exists('checks', stuck.checkId)).toBe(1);
    expect(anonKeys(stuck)).toHaveLength(5);
    expect(await exists('sites', gone.siteId)).toBe(0);
  });

  it('removes the copies a Keep that did not commit left under its account, with the site’s own objects', async () => {
    // Two accounts' Keeps of one check, each refused (the check has expired on the database's
    // clock) and each unable to remove its copies; a third account's objects of another check stay.
    const check = await storedCheck(db, memory, { host: host(), expiresAt: EXPIRED, built: true });
    const kept = await storedCheck(db, memory, { host: host(), expiresAt: LATER });
    const [first, second, third] = [await keeper(), await keeper(), await keeper()];
    const noRemove: Evidence = {
      ...memory,
      remove: async () => {
        throw new Error('storage: remove refused');
      },
    };
    const reported: Record<string, string>[] = [];
    const refused = claimKeep({
      store: sqlKeepStore(asService(db)),
      evidence: noRemove,
      report: (_signal, extra) => reported.push(extra),
    });
    for (const who of [first, second]) {
      expect(
        await refused.keep({
          checkId: check.checkId,
          siteId: check.siteId,
          ...who,
          schedule: null,
        }),
      ).toBe('expired');
    }
    expect(reported.map((r) => r.accountId)).toEqual([first.accountId, second.accountId]);
    expect(
      await claimKeep({
        store: sqlKeepStore(asService(db)),
        evidence: memory,
        report: () => {},
      }).keep({ checkId: kept.checkId, siteId: kept.siteId, ...third, schedule: null }),
    ).toBe('taken');
    const ofCheck = () => [...memory.objects.keys()].filter((k) => k.includes(check.checkId));
    // Six objects (two batches, seeds, render, map, built) under anon/ and under each account.
    expect(ofCheck()).toHaveLength(18);
    const others = [...memory.objects.keys()].filter((k) => !k.includes(check.checkId)).sort();
    expect(others).toHaveLength(5);

    expect(await expireUnkept(depsOf())).toEqual({ sites: 1, checks: 1, skipped: 0, left: 0 });
    expect(ofCheck()).toEqual([]);
    expect([...memory.objects.keys()].sort()).toEqual(others);
  });

  it('a site whose copies under an account cannot be removed is skipped with its rows', async () => {
    const check = await storedCheck(db, memory, { host: host(), expiresAt: EXPIRED });
    const who = await keeper();
    await asService(db)((tx) =>
      tx.query(`select public.note_check_copy($1::uuid, $2::uuid)`, [check.checkId, who.accountId]),
    );
    const evidence: Evidence = {
      ...memory,
      remove: async (paths) => {
        if (paths.some((p) => p.startsWith(`${who.accountId}/`)))
          throw new Error('storage: remove refused');
        return memory.remove(paths);
      },
    };
    expect(await expireUnkept(depsOf({ evidence }))).toEqual({
      sites: 0,
      checks: 0,
      skipped: 1,
      left: 0,
    });
    expect(await exists('checks', check.checkId)).toBe(1);
  });

  it('works in bounded batches and reports what is left', async () => {
    const checks: StoredCheck[] = [];
    for (let i = 0; i < 5; i++) {
      checks.push(await storedCheck(db, memory, { host: host(), expiresAt: EXPIRED, batches: 0 }));
    }
    const bounds = { batch: 2, maxBatches: 2 };
    expect(await expireUnkept(depsOf({ bounds }))).toEqual({
      sites: 4,
      checks: 4,
      skipped: 0,
      left: 1,
    });
    expect(await count(db, `select 1 from public.sites where account_id is null`)).toBe(1);
    expect(await expireUnkept(depsOf({ bounds }))).toEqual({
      sites: 1,
      checks: 1,
      skipped: 0,
      left: 0,
    });
    expect(EXPIRY_BATCH_SITES * EXPIRY_MAX_BATCHES).toBe(1000);
  });

  it('starts no batch after the step’s time budget, and reports what is left', async () => {
    for (let i = 0; i < 3; i++) {
      await storedCheck(db, memory, { host: host(), expiresAt: EXPIRED, batches: 0 });
    }
    let reads = 0;
    // The run reads the clock when it starts and before each later batch: the second read is late.
    const now = () => (reads++ < 1 ? NOW : NOW + STEP_BUDGET_MS + 1);
    expect(await expireUnkept(depsOf({ now, bounds: { batch: 1, maxBatches: 10 } }))).toEqual({
      sites: 1,
      checks: 1,
      skipped: 0,
      left: 2,
    });
  });
});

describe('a claim against the expiry, at each point', () => {
  const claim = (check: StoredCheck, who: { accountId: string; ownerSeatId: string }) =>
    claimKeep({ store: sqlKeepStore(asService(db)), evidence: memory, report: () => {} }).keep({
      checkId: check.checkId,
      siteId: check.siteId,
      ...who,
      schedule: null,
    });

  it('before the expiry reads: the check is kept and the expiry leaves it whole', async () => {
    const check = await storedCheck(db, memory, { host: host(), expiresAt: LATER });
    const who = await keeper();
    expect(await claim(check, who)).toBe('taken');
    const before = new Map(memory.objects);
    // A day later, when the check would have expired.
    const now = () => NOW + 48 * HOUR;
    expect(await expireUnkept(depsOf({ now }))).toEqual({
      sites: 0,
      checks: 0,
      skipped: 0,
      left: 0,
    });
    expect(await exists('checks', check.checkId)).toBe(1);
    expect(memory.objects).toEqual(before);
  });

  it('between the object removal and the delete: keep_check refuses the expired check, and the site is deleted', async () => {
    const check = await storedCheck(db, memory, { host: host(), expiresAt: EXPIRED });
    const who = await keeper();
    const real = sqlExpireStore(asService(db));
    let claimed: string | null = null;
    const store: ExpireStore = {
      ...real,
      deleteExpiredUnkept: async (...args) => {
        claimed = await claim(check, who);
        return real.deleteExpiredUnkept(...args);
      },
    };
    expect(await expireUnkept(depsOf({ store }))).toEqual({
      sites: 1,
      checks: 1,
      skipped: 0,
      left: 0,
    });
    expect(claimed).toBe('expired');
    expect(await exists('sites', check.siteId)).toBe(0);
  });

  it('a site an account took after it was listed is not deleted: the delete statement tests the site again', async () => {
    const check = await storedCheck(db, memory, { host: host(), expiresAt: EXPIRED });
    const who = await keeper();
    const real = sqlExpireStore(asService(db));
    const store: ExpireStore = {
      ...real,
      deleteExpiredUnkept: async (...args) => {
        // What the flag-off claim's first write does, with no expiry test in the database.
        await db.query(`update public.sites set account_id = $2 where id = $1`, [
          check.siteId,
          who.accountId,
        ]);
        return real.deleteExpiredUnkept(...args);
      },
    };
    expect((await expireUnkept(depsOf({ store }))).sites).toBe(0);
    expect(await siteAccount(db, check.siteId)).toBe(who.accountId);
    expect(await exists('checks', check.checkId)).toBe(1);
  });

  it('after the delete: there is nothing to claim', async () => {
    const check = await storedCheck(db, memory, { host: host(), expiresAt: EXPIRED });
    const who = await keeper();
    await expireUnkept(depsOf());
    expect(await claim(check, who)).toBe('not_unowned');
  });
});

describe('what an expired site takes with it (the cascade, table by table)', () => {
  it('leaves no row that names the check or its site', async () => {
    const check = await recordedStoredCheck(db, memory, EXPIRED.toISOString());
    const who = await keeper();
    const fix = await db.query<{ id: string }>(
      `select id from public.site_fixes where site_id = $1 limit 1`,
      [check.siteId],
    );
    const fixId = fix.rows[0]!.id;
    await db.query(
      `insert into public.fix_events (fix_id, at, kind, check_id) values ($1, now(), 'verified', $2),
                                                                      ($1, now(), 'reopened', $2)`,
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
       values ($1, 'anon/x', 1, 1, repeat('0', 64))`,
      [check.checkId],
    );
    await db.query(
      `insert into public.persist_chunks (check_id, collection, chunk, rows)
       values ($1, 'page_results', 0, '[]'::jsonb)`,
      [check.checkId],
    );
    // usage_events cannot name a check of a site no account keeps: its trigger refuses the row,
    // so the foreign key's `on delete set null` has nothing to clear here.
    await expect(
      db.query(
        `insert into public.usage_events (account_id, kind, check_id, result, billable,
                                          compute_seconds, request_count, idempotency_key)
         values ($1, 'check_finished', $2, 'delivered', false, 1, 1, 'expiry-cascade-test')`,
        [who.accountId, check.checkId],
      ),
    ).rejects.toThrow("check_id must be a check of the event's account");

    const byCheck = [
      'page_results',
      'link_edges',
      'access_tests',
      'crawl_batches',
      'persist_chunks',
      'evidence_blobs',
      'changes',
    ] as const;
    const bySite = ['checks', 'site_fixes', 'changes'] as const;
    const rows = async () => {
      const counts: Record<string, number> = {};
      for (const t of byCheck) {
        counts[`${t} by check`] = await count(db, `select 1 from public.${t} where check_id = $1`, [
          check.checkId,
        ]);
      }
      for (const t of bySite) {
        counts[`${t} by site`] = await count(db, `select 1 from public.${t} where site_id = $1`, [
          check.siteId,
        ]);
      }
      counts['fix_events by fix'] = await count(
        db,
        `select 1 from public.fix_events where fix_id = $1`,
        [fixId],
      );
      counts['sites'] = await count(db, `select 1 from public.sites where id = $1`, [check.siteId]);
      return counts;
    };
    const before = await rows();
    for (const [table, held] of Object.entries(before)) expect(held, table).toBeGreaterThan(0);

    expect(await expireUnkept(depsOf())).toEqual({ sites: 1, checks: 1, skipped: 0, left: 0 });
    const after = await rows();
    for (const [table, held] of Object.entries(after)) expect(held, table).toBe(0);
    expect([...memory.objects.keys()]).toEqual([]);
  }, 120_000);
});

describe('settleKept', () => {
  const NAMES = (check: StoredCheck): EvidenceName[] => [
    ...check.batches.map((b): EvidenceName => `batch-${b}`),
    'seeds',
    'render',
    'map',
  ];
  const under = (check: StoredCheck, accountId: string) =>
    NAMES(check)
      .map((name) => evidencePath({ ...anonOwner(check), accountId }, name))
      .sort();

  it('moves an ended kept check whose stored paths are still under anon/', async () => {
    const check = await storedCheck(db, memory, { host: host(), expiresAt: null });
    const who = await keeper();
    // Kept long before the sweep window, as a claim whose copy failed leaves it.
    await db.query(`update public.sites set account_id = $2, updated_at = $3 where id = $1`, [
      check.siteId,
      who.accountId,
      new Date(NOW - 2 * SETTLE_SWEEP_MS),
    ]);
    expect(await settleKept(depsOf())).toEqual({ moved: 1, nothing: 0, failed: 0, left: 0 });
    expect([...memory.objects.keys()].sort()).toEqual(under(check, who.accountId));
    for (const path of await storedPaths(db, check.checkId)) {
      expect(path.startsWith(`${who.accountId}/`), path).toBe(true);
    }
    expect(await settleKept(depsOf())).toEqual({ moved: 0, nothing: 0, failed: 0, left: 0 });
  });

  it('removes what a claim’s failed removal left under anon/, while the claim is inside the sweep window', async () => {
    const check = await storedCheck(db, memory, { host: host(), expiresAt: LATER });
    const who = await keeper();
    const noRemove: Evidence = {
      ...memory,
      remove: async () => {
        throw new Error('storage: remove refused');
      },
    };
    const kept = await claimKeep({
      store: sqlKeepStore(asService(db)),
      evidence: noRemove,
      report: () => {},
    }).keep({ checkId: check.checkId, siteId: check.siteId, ...who, schedule: null });
    expect(kept).toBe('taken');
    expect(anonKeys(check)).toHaveLength(5);

    expect(await settleKept(depsOf())).toEqual({ moved: 1, nothing: 0, failed: 0, left: 0 });
    expect([...memory.objects.keys()].sort()).toEqual(under(check, who.accountId));
    // Inside the window the check is listed again, and holds nothing under anon/.
    expect(await settleKept(depsOf())).toEqual({ moved: 0, nothing: 1, failed: 0, left: 0 });
    // Past the window it is not listed.
    const later = () => NOW + SETTLE_SWEEP_MS + HOUR;
    expect(await settleKept(depsOf({ now: later }))).toEqual({
      moved: 0,
      nothing: 0,
      failed: 0,
      left: 0,
    });
  });

  it('removes the copies a refused Keep left under another account, for a check claimed inside the sweep window, whatever its trigger', async () => {
    const check = await storedCheck(db, memory, { host: host(), expiresAt: LATER });
    // Not a first audit: the sweep's other arm does not list it.
    await db.query(`update public.checks set trigger = 'manual' where id = $1`, [check.checkId]);
    const winner = await keeper();
    const loser = await keeper();
    const keepStore = sqlKeepStore(asService(db));
    // The loser's Keep copied and then lost the site to the winner; its discard failed.
    let won = 'not run';
    let readBack = 0;
    const racing: Evidence = {
      ...memory,
      remove: async () => {
        throw new Error('storage: remove refused');
      },
      get: async (path) => {
        const bytes = await memory.get(path);
        // The winner's claim runs whole once the loser's last copy has been written and read back.
        if (path.startsWith(`${loser.accountId}/`) && ++readBack === NAMES(check).length) {
          won = await claimKeep({ store: keepStore, evidence: memory, report: () => {} }).keep({
            checkId: check.checkId,
            siteId: check.siteId,
            ...winner,
            schedule: null,
          });
        }
        return bytes;
      },
    };
    expect(
      await claimKeep({ store: keepStore, evidence: racing, report: () => {} }).keep({
        checkId: check.checkId,
        siteId: check.siteId,
        ...loser,
        schedule: null,
      }),
    ).toBe('not_unowned');
    expect(won).toBe('taken');
    const leftBy = (accountId: string) =>
      [...memory.objects.keys()].filter((k) => k.startsWith(`${accountId}/`)).sort();
    expect(leftBy(loser.accountId)).toEqual(under(check, loser.accountId));

    // Past the window the check is not listed, and the copies stay.
    const later = () => NOW + SETTLE_SWEEP_MS + HOUR;
    expect(await settleKept(depsOf({ now: later }))).toEqual({
      moved: 0,
      nothing: 0,
      failed: 0,
      left: 0,
    });
    expect(leftBy(loser.accountId)).toEqual(under(check, loser.accountId));

    expect(await settleKept(depsOf())).toEqual({ moved: 0, nothing: 1, failed: 0, left: 0 });
    expect(leftBy(loser.accountId)).toEqual([]);
    expect([...memory.objects.keys()].sort()).toEqual(under(check, winner.accountId));
    for (const path of await storedPaths(db, check.checkId)) {
      expect(memory.objects.has(path), path).toBe(true);
    }
  });

  it('does not list a kept check that is still running, or any check of an unkept site', async () => {
    const running = await storedCheck(db, memory, {
      host: host(),
      expiresAt: null,
      status: 'running',
    });
    const unkept = await storedCheck(db, memory, { host: host(), expiresAt: LATER });
    const who = await keeper();
    await db.query(`update public.sites set account_id = $2 where id = $1`, [
      running.siteId,
      who.accountId,
    ]);
    const before = new Map(memory.objects);
    expect(await settleKept(depsOf())).toEqual({ moved: 0, nothing: 0, failed: 0, left: 0 });
    expect(memory.objects).toEqual(before);
    expect(await siteAccount(db, unkept.siteId)).toBeNull();
  });

  it('counts a check whose copy fails, changes nothing of it, and goes on to the next', async () => {
    const who = await keeper();
    const [bad, good] = [
      await storedCheck(db, memory, { host: host(), expiresAt: null }),
      await storedCheck(db, memory, { host: host(), expiresAt: null }),
    ];
    for (const check of [bad, good]) {
      await db.query(`update public.sites set account_id = $2 where id = $1`, [
        check.siteId,
        who.accountId,
      ]);
    }
    const evidence: Evidence = {
      ...memory,
      put: async (path, bytes) => {
        if (path.includes(bad.checkId)) throw new Error('storage: put refused');
        return memory.put(path, bytes);
      },
    };
    expect(await settleKept(depsOf({ evidence }))).toEqual({
      moved: 1,
      nothing: 0,
      failed: 1,
      left: 0,
    });
    for (const path of await storedPaths(db, bad.checkId)) {
      expect(path.startsWith('anon/'), path).toBe(true);
      expect(memory.objects.get(path)).toEqual(
        objectBytes(bad.checkId, path.slice(path.lastIndexOf('/') + 1, -8) as EvidenceName),
      );
    }
    for (const path of await storedPaths(db, good.checkId)) {
      expect(path.startsWith(`${who.accountId}/`), path).toBe(true);
    }
  });

  it('works in bounded batches and reports what is left', async () => {
    const who = await keeper();
    await db.query(`update public.accounts set site_limit = 10 where id = $1`, [who.accountId]);
    for (let i = 0; i < 3; i++) {
      const check = await storedCheck(db, memory, { host: host(), expiresAt: null, batches: 1 });
      await db.query(`update public.sites set account_id = $2 where id = $1`, [
        check.siteId,
        who.accountId,
      ]);
    }
    expect(await settleKept(depsOf({ bounds: { batch: 1, maxBatches: 2 } }))).toEqual({
      moved: 2,
      nothing: 0,
      failed: 0,
      left: 1,
    });
  });
});
