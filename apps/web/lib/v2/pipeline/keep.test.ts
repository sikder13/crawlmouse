/**
 * The evidence move of a kept audit (CC-22b D7) on PGlite with every migration and an evidence
 * store in memory: `claimKeep` as the claim calls it, and `settleKeptCheck` as the daily function
 * does. Stores run each call as one service-role transaction.
 */
import type { PGlite } from '@electric-sql/pglite';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountOf, doorDb, signUp } from '../../../__tests__/v2/_lib/door-pglite';
import type { ClaimKeepInput } from '../../auth/claim';
import { evidenceDir, getJson, type EvidenceDirectory } from './evidence';
import {
  claimKeep,
  copyPaths,
  KEEP_MOVE_BUDGET_MS,
  objectNames,
  settleKeptCheck,
  type KeepDeps,
} from './keep';
import { loadCheck } from './load';
import { memoryEvidenceStore } from './test-support/memory-evidence';
import { pgliteCheckReader } from './test-support/pglite';
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

const LATER = new Date('2099-01-01T00:00:00Z');
type Evidence = EvidenceStore & EvidenceDirectory;
type Memory = ReturnType<typeof memoryEvidenceStore>;

let db: PGlite;
let n = 0;
/** A new account's id and owner seat. */
async function keeper(): Promise<{ accountId: string; ownerSeatId: string }> {
  const user = await signUp(db, `keeper-${++n}@example.com`);
  const account = await accountOf(db, user);
  const { rows } = await db.query<{ id: string }>(
    `select id from public.seats where account_id = $1 and role = 'owner'`,
    [account.id],
  );
  return { accountId: account.id, ownerSeatId: rows[0]!.id };
}
const host = () => `site-${++n}.example`;

beforeAll(async () => {
  db = await doorDb();
}, 120_000);
afterAll(async () => {
  await db?.close();
});

interface Reported {
  signal: string;
  extra: Record<string, string>;
}

function depsOf(evidence: Evidence, budgetMs = KEEP_MOVE_BUDGET_MS) {
  const reported: Reported[] = [];
  const deps: KeepDeps = {
    store: sqlKeepStore(asService(db)),
    evidence,
    report: (signal, extra) => reported.push({ signal, extra }),
    budgetMs,
  };
  return { deps, reported };
}

const inputOf = (
  check: StoredCheck,
  who: { accountId: string; ownerSeatId: string },
): ClaimKeepInput => ({ checkId: check.checkId, siteId: check.siteId, ...who, schedule: null });

const pathsOf = (check: StoredCheck, accountId: string | null, names: readonly EvidenceName[]) =>
  names.map((name) => evidencePath({ ...anonOwner(check), accountId }, name)).sort();

/** The objects the fixture stores for an ended check. */
const STORED = (check: StoredCheck): EvidenceName[] => [
  ...check.batches.map((b): EvidenceName => `batch-${b}`),
  'seeds',
  'render',
  'map',
];
/** Those of them a row names: the batches' results and the map. */
const NAMED_BY_ROWS = (check: StoredCheck): EvidenceName[] => [
  ...check.batches.map((b): EvidenceName => `batch-${b}`),
  'map',
];

const keysUnder = (memory: Memory, prefix: string) =>
  [...memory.objects.keys()].filter((k) => k.startsWith(`${prefix}/`)).sort();

/** The check's objects in an account's directory of it. */
const copiesFor = (memory: Memory, check: StoredCheck, accountId: string) =>
  keysUnder(memory, evidenceDir({ ...anonOwner(check), accountId }));

const copiedFor = async (checkId: string): Promise<string[]> =>
  (
    await db.query<{ copied_for: string[] }>(`select copied_for from public.checks where id = $1`, [
      checkId,
    ])
  ).rows[0]!.copied_for;

type Op = 'list' | 'get' | 'put' | 'remove';

/**
 * `evidence`, with `fail(op, path, nth)` awaited before each call: true makes that call throw. A
 * test runs another claim whole inside `fail` to place it before that call.
 */
function failing(
  inner: Evidence,
  fail: (op: Op, path: string, nth: number) => boolean | Promise<boolean>,
): Evidence {
  let calls = 0;
  const gate = async (op: Op, path: string) => {
    if (await fail(op, path, ++calls)) throw new Error(`storage: ${op} refused`);
  };
  return {
    async list(dir) {
      await gate('list', dir);
      return inner.list(dir);
    },
    async get(path) {
      await gate('get', path);
      return inner.get(path);
    },
    async put(path, bytes) {
      await gate('put', path);
      return inner.put(path, bytes);
    },
    async remove(paths) {
      await gate('remove', paths[0] ?? '');
      return inner.remove(paths);
    },
  };
}

describe('objectNames', () => {
  it('names a check’s objects from its batch numbers, whatever its rows store', () => {
    expect(objectNames([0, 3])).toEqual(['seeds', 'render', 'built', 'map', 'batch-0', 'batch-3']);
  });
});

describe('keeping a finished check moves its evidence to the account', () => {
  it('each object is under the account, none under anon/, and the check and its map read back', async () => {
    // A database of its own: the recorded site has fixed ids.
    const own = await doorDb();
    try {
      const memory = memoryEvidenceStore();
      const check = await recordedStoredCheck(own, memory, LATER.toISOString());
      const user = await signUp(own, 'recorded@example.com');
      const account = await accountOf(own, user);
      const seat = await own.query<{ id: string }>(
        `select id from public.seats where account_id = $1 and role = 'owner'`,
        [account.id],
      );
      const before = new Map(memory.objects);
      const deps: KeepDeps = {
        store: sqlKeepStore(asService(own)),
        evidence: memory,
        report: () => {},
      };
      const outcome = await claimKeep(deps).keep({
        checkId: check.checkId,
        siteId: check.siteId,
        accountId: account.id,
        ownerSeatId: seat.rows[0]!.id,
        schedule: null,
      });
      expect(outcome).toBe('taken');

      const stored: EvidenceName[] = [
        ...check.batches.map((b): EvidenceName => `batch-${b}`),
        'seeds',
        'map',
      ];
      expect([...memory.objects.keys()].sort()).toEqual(pathsOf(check, account.id, stored));
      for (const name of stored) {
        expect(
          memory.objects.get(evidencePath({ ...anonOwner(check), accountId: account.id }, name)),
        ).toEqual(before.get(evidencePath(anonOwner(check), name)));
      }
      expect(await storedPaths(own, check.checkId)).toEqual(
        pathsOf(check, account.id, [
          ...check.batches.map((b): EvidenceName => `batch-${b}`),
          'map',
        ]),
      );
      const loaded = await loadCheck(pgliteCheckReader(own), check.checkId);
      expect(loaded.checks.map((c) => c.id)).toContain(check.checkId);
      const { rows } = await own.query<{ map_path: string; expires_at: Date | null }>(
        `select map_path, expires_at from public.checks where id = $1`,
        [check.checkId],
      );
      expect(rows[0]!.expires_at).toBeNull();
      expect(await getJson(memory, rows[0]!.map_path)).toMatchObject({ nodes: expect.any(Array) });
    } finally {
      await own.close();
    }
  }, 120_000);
});

describe('claimKeep', () => {
  it('a copy that fails on any object still keeps the check, and rewrites no stored path', async () => {
    const probe = memoryEvidenceStore();
    const shape = await storedCheck(db, probe, { host: host(), expiresAt: LATER });
    // One list, then get, put, get for each of the five objects.
    const calls = 1 + 3 * STORED(shape).length;
    for (let nth = 1; nth <= calls; nth++) {
      const memory = memoryEvidenceStore();
      const check = await storedCheck(db, memory, { host: host(), expiresAt: LATER });
      const who = await keeper();
      const { deps, reported } = depsOf(
        failing(memory, (op, _p, at) => op !== 'remove' && at === nth),
      );
      expect(await claimKeep(deps).keep(inputOf(check, who)), `call ${nth}`).toBe('taken');
      expect(await siteAccount(db, check.siteId)).toBe(who.accountId);
      expect(await storedPaths(db, check.checkId), `call ${nth}`).toEqual(
        pathsOf(check, null, NAMED_BY_ROWS(check)),
      );
      for (const name of STORED(check)) {
        expect(memory.objects.get(evidencePath(anonOwner(check), name)), `call ${nth}`).toEqual(
          objectBytes(check.checkId, name),
        );
      }
      expect(reported.map((r) => r.signal)).toEqual(['keep-evidence-not-moved']);
      expect(reported[0]!.extra).toEqual({ checkId: check.checkId });
    }
  }, 120_000);

  it('a copy that reads back other bytes is not a copy: no stored path is rewritten', async () => {
    const memory = memoryEvidenceStore();
    const check = await storedCheck(db, memory, { host: host(), expiresAt: LATER });
    const who = await keeper();
    const corrupting: Evidence = {
      ...memory,
      put: (path, bytes) =>
        memory.put(
          path,
          path.endsWith('batch-1.json.gz') ? bytes.slice(0, bytes.length - 1) : bytes,
        ),
    };
    const { deps, reported } = depsOf(corrupting);
    expect(await claimKeep(deps).keep(inputOf(check, who))).toBe('taken');
    expect(await storedPaths(db, check.checkId)).toEqual(
      pathsOf(check, null, NAMED_BY_ROWS(check)),
    );
    expect(reported.map((r) => r.signal)).toEqual(['keep-evidence-not-moved']);
  });

  it('a copy that passes its budget still keeps the check, on its old paths', async () => {
    const memory = memoryEvidenceStore();
    const check = await storedCheck(db, memory, { host: host(), expiresAt: LATER });
    const who = await keeper();
    const stuck: Evidence = { ...memory, get: () => new Promise<Uint8Array>(() => {}) };
    const { deps, reported } = depsOf(stuck, 30);
    expect(await claimKeep(deps).keep(inputOf(check, who))).toBe('taken');
    expect(await siteAccount(db, check.siteId)).toBe(who.accountId);
    expect(await storedPaths(db, check.checkId)).toEqual(
      pathsOf(check, null, NAMED_BY_ROWS(check)),
    );
    expect(reported.map((r) => r.signal)).toEqual(['keep-evidence-not-moved']);
  });

  it('a check that is still running or queued is taken without a move', async () => {
    for (const status of ['running', 'queued'] as const) {
      const memory = memoryEvidenceStore();
      const check = await storedCheck(db, memory, { host: host(), expiresAt: LATER, status });
      const who = await keeper();
      const before = [...memory.objects.keys()].sort();
      const touched: string[] = [];
      const { deps, reported } = depsOf(
        failing(memory, (op) => {
          touched.push(op);
          return false;
        }),
      );
      expect(await claimKeep(deps).keep(inputOf(check, who))).toBe('taken');
      expect(touched).toEqual([]);
      expect([...memory.objects.keys()].sort()).toEqual(before);
      expect(await storedPaths(db, check.checkId)).toEqual(
        pathsOf(
          check,
          null,
          check.batches.map((b): EvidenceName => `batch-${b}`),
        ),
      );
      expect(reported).toEqual([]);
    }
  });

  it('a refused commit (expired on the database clock) leaves the old objects and removes the copies', async () => {
    const memory = memoryEvidenceStore();
    const check = await storedCheck(db, memory, {
      host: host(),
      expiresAt: new Date(Date.now() - 1000),
    });
    const who = await keeper();
    const before = [...memory.objects.keys()].sort();
    expect(await claimKeep(depsOf(memory).deps).keep(inputOf(check, who))).toBe('expired');
    expect([...memory.objects.keys()].sort()).toEqual(before);
    // The account stays on the row: the expiry removes by it whatever a late request wrote.
    expect(await copiedFor(check.checkId)).toEqual([who.accountId]);
    expect(await siteAccount(db, check.siteId)).toBeNull();
    expect(await storedPaths(db, check.checkId)).toEqual(
      pathsOf(check, null, NAMED_BY_ROWS(check)),
    );
  });

  it('a refused commit (the account keeps that host) leaves the old objects and removes the copies', async () => {
    const memory = memoryEvidenceStore();
    const shared = host();
    const who = await keeper();
    const first = await storedCheck(db, memory, { host: shared, expiresAt: LATER });
    const second = await storedCheck(db, memory, { host: shared, expiresAt: LATER });
    const { deps } = depsOf(memory);
    expect(await claimKeep(deps).keep(inputOf(first, who))).toBe('taken');
    const before = keysUnder(memory, 'anon');
    expect(await claimKeep(deps).keep(inputOf(second, who))).toBe('host_kept');
    expect(keysUnder(memory, 'anon')).toEqual(before);
    expect(
      keysUnder(memory, evidenceDir({ ...anonOwner(second), accountId: who.accountId })),
    ).toEqual([]);
    expect(await siteAccount(db, second.siteId)).toBeNull();
  });

  it('a site another account took first is not_unowned, and the loser’s copies are removed', async () => {
    const memory = memoryEvidenceStore();
    const check = await storedCheck(db, memory, { host: host(), expiresAt: LATER });
    const winner = await keeper();
    const loser = await keeper();
    // The winner's claim runs whole before the loser's last read-back, so before the loser's commit.
    const calls = 1 + 3 * STORED(check).length;
    let won: string | null = null;
    const racing = failing(memory, async (_op, _p, nth) => {
      if (nth === calls) won = await claimKeep(depsOf(memory).deps).keep(inputOf(check, winner));
      return false;
    });
    expect(await claimKeep(depsOf(racing).deps).keep(inputOf(check, loser))).toBe('not_unowned');
    expect(won).toBe('taken');
    expect(await siteAccount(db, check.siteId)).toBe(winner.accountId);
    expect(await copiedFor(check.checkId)).toEqual([loser.accountId]);
    expect(
      keysUnder(memory, evidenceDir({ ...anonOwner(check), accountId: loser.accountId })),
    ).toEqual([]);
    expect(await storedPaths(db, check.checkId)).toEqual(
      pathsOf(check, winner.accountId, NAMED_BY_ROWS(check)),
    );
    for (const path of await storedPaths(db, check.checkId)) {
      expect(memory.objects.has(path), path).toBe(true);
    }
  });

  it('the same claim racing itself at each step ends with one owner and one set of objects', async () => {
    const probe = memoryEvidenceStore();
    const shape = await storedCheck(db, probe, { host: host(), expiresAt: LATER });
    // List, three calls an object, and the removal of the old objects.
    const calls = 2 + 3 * STORED(shape).length;
    for (let at = 1; at <= calls; at++) {
      const memory = memoryEvidenceStore();
      const check = await storedCheck(db, memory, { host: host(), expiresAt: LATER });
      const who = await keeper();
      let theirs = 'not run';
      // The second call of the same claim runs whole just before the first call's `at`th storage call.
      const first = failing(memory, async (_op, _p, nth) => {
        if (nth === at) theirs = await claimKeep(depsOf(memory).deps).keep(inputOf(check, who));
        return false;
      });
      const mine = await claimKeep(depsOf(first).deps).keep(inputOf(check, who));
      expect([mine, theirs].sort(), `step ${at}`).toEqual(['not_unowned', 'taken']);
      expect(await siteAccount(db, check.siteId)).toBe(who.accountId);
      const stored = await storedPaths(db, check.checkId);
      for (const path of stored) expect(memory.objects.has(path), `step ${at}: ${path}`).toBe(true);
      // Whatever the interleaving left, a settle finishes it: every object under the account.
      expect(
        await settleKeptCheck(depsOf(memory).deps, { ...check, accountId: who.accountId }),
      ).toMatch(/moved|nothing/);
      expect([...memory.objects.keys()].sort(), `step ${at}`).toEqual(
        pathsOf(check, who.accountId, STORED(check)),
      );
      expect(await storedPaths(db, check.checkId), `step ${at}`).toEqual(
        pathsOf(check, who.accountId, NAMED_BY_ROWS(check)),
      );
    }
  }, 120_000);

  it('the account is on the check’s row before the first storage call, and off it once the Keep commits', async () => {
    const memory = memoryEvidenceStore();
    const check = await storedCheck(db, memory, { host: host(), expiresAt: LATER });
    const who = await keeper();
    const seen: string[][] = [];
    const watching = failing(memory, async (_op, _p, nth) => {
      if (nth === 1) seen.push(await copiedFor(check.checkId));
      return false;
    });
    expect(await copiedFor(check.checkId)).toEqual([]);
    expect(await claimKeep(depsOf(watching).deps).keep(inputOf(check, who))).toBe('taken');
    expect(seen).toEqual([[who.accountId]]);
    expect(await copiedFor(check.checkId)).toEqual([]);
  });

  it('copies nothing when the account cannot be recorded, and still keeps the check on its old paths', async () => {
    for (const noteCopy of [
      async () => {
        throw new Error('database: refused');
      },
      async () => false,
    ]) {
      const memory = memoryEvidenceStore();
      const check = await storedCheck(db, memory, { host: host(), expiresAt: LATER });
      const who = await keeper();
      const touched: string[] = [];
      const { deps, reported } = depsOf(
        failing(memory, (op) => {
          touched.push(op);
          return false;
        }),
      );
      const unrecorded: KeepDeps = { ...deps, store: { ...deps.store, noteCopy } };
      expect(await claimKeep(unrecorded).keep(inputOf(check, who))).toBe('taken');
      expect(touched).toEqual([]);
      expect(await storedPaths(db, check.checkId)).toEqual(
        pathsOf(check, null, NAMED_BY_ROWS(check)),
      );
      expect(reported.map((r) => r.signal)).toEqual(['keep-evidence-not-moved']);
    }
  });

  it('a commit that throws removes the copies it made and throws the same error', async () => {
    const memory = memoryEvidenceStore();
    const check = await storedCheck(db, memory, { host: host(), expiresAt: LATER });
    const who = await keeper();
    const before = [...memory.objects.keys()].sort();
    const { deps, reported } = depsOf(memory);
    const down = new Error('database: connection lost');
    let copiesAtCommit: string[] = [];
    const throwing: KeepDeps = {
      ...deps,
      store: {
        ...deps.store,
        keep: async () => {
          copiesAtCommit = copiesFor(memory, check, who.accountId);
          throw down;
        },
      },
    };
    await expect(claimKeep(throwing).keep(inputOf(check, who))).rejects.toBe(down);
    expect(copiesAtCommit).toEqual(pathsOf(check, who.accountId, STORED(check)));
    expect([...memory.objects.keys()].sort()).toEqual(before);
    expect(await siteAccount(db, check.siteId)).toBeNull();
    expect(reported).toEqual([]);
    expect(await copiedFor(check.checkId)).toEqual([who.accountId]);
  });

  it('a commit whose answer was lost after it committed keeps the copies: the rows name them', async () => {
    const memory = memoryEvidenceStore();
    const check = await storedCheck(db, memory, { host: host(), expiresAt: LATER });
    const who = await keeper();
    const { deps } = depsOf(memory);
    const lost: KeepDeps = {
      ...deps,
      store: {
        ...deps.store,
        keep: async (commit) => {
          await deps.store.keep(commit);
          throw new Error('database: answer lost');
        },
      },
    };
    await expect(claimKeep(lost).keep(inputOf(check, who))).rejects.toThrow('answer lost');
    expect(await siteAccount(db, check.siteId)).toBe(who.accountId);
    for (const path of await storedPaths(db, check.checkId)) {
      expect(memory.objects.has(path), path).toBe(true);
    }
  });

  it('a discard that fails is reported with the account and how many objects it left, for a refused commit and for a thrown one', async () => {
    for (const commit of ['refused', 'threw'] as const) {
      const memory = memoryEvidenceStore();
      const check = await storedCheck(db, memory, {
        host: host(),
        expiresAt: commit === 'refused' ? new Date(Date.now() - 1000) : LATER,
      });
      const who = await keeper();
      const { deps, reported } = depsOf(failing(memory, (op) => op === 'remove'));
      const run: KeepDeps =
        commit === 'refused'
          ? deps
          : {
              ...deps,
              store: {
                ...deps.store,
                keep: async () => {
                  throw new Error('database: connection lost');
                },
              },
            };
      const outcome = await claimKeep(run)
        .keep(inputOf(check, who))
        .catch(() => 'threw');
      expect(outcome).toBe(commit === 'refused' ? 'expired' : 'threw');
      expect(reported, commit).toEqual([
        {
          signal: 'keep-evidence-discard-failed',
          extra: {
            checkId: check.checkId,
            accountId: who.accountId,
            objects: String(STORED(check).length),
          },
        },
      ]);
      // What it left is findable: the names under the account the row records.
      expect(copiesFor(memory, check, who.accountId)).toEqual(
        pathsOf(check, who.accountId, STORED(check)),
      );
      expect(copyPaths(check, who.accountId).sort()).toEqual(
        pathsOf(check, who.accountId, objectNames(check.batches)),
      );
      expect(await copiedFor(check.checkId)).toEqual([who.accountId]);
    }
  });

  it('a removal that fails after the commit is reported, and the next settle finishes it', async () => {
    const memory = memoryEvidenceStore();
    const check = await storedCheck(db, memory, { host: host(), expiresAt: LATER });
    const who = await keeper();
    const { deps, reported } = depsOf(failing(memory, (op) => op === 'remove'));
    expect(await claimKeep(deps).keep(inputOf(check, who))).toBe('taken');
    expect(reported.map((r) => r.signal)).toEqual(['keep-evidence-remove-failed']);
    expect(await storedPaths(db, check.checkId)).toEqual(
      pathsOf(check, who.accountId, NAMED_BY_ROWS(check)),
    );
    expect(keysUnder(memory, 'anon')).toEqual(pathsOf(check, null, STORED(check)));

    const kept = { ...check, accountId: who.accountId };
    expect(await settleKeptCheck(depsOf(memory).deps, kept)).toBe('moved');
    expect([...memory.objects.keys()].sort()).toEqual(pathsOf(check, who.accountId, STORED(check)));
    const after = new Map(memory.objects);
    expect(await settleKeptCheck(depsOf(memory).deps, kept)).toBe('nothing');
    expect(memory.objects).toEqual(after);
  });
});

describe('settleKeptCheck', () => {
  it('moves a check that was kept while it ran, once it has ended, with its unnamed objects', async () => {
    const memory = memoryEvidenceStore();
    const check = await storedCheck(db, memory, {
      host: host(),
      expiresAt: LATER,
      status: 'running',
    });
    const who = await keeper();
    const { deps } = depsOf(memory);
    expect(await claimKeep(deps).keep(inputOf(check, who))).toBe('taken');
    // The run ends: it failed after build, leaving `built` and a map no row names.
    await db.query(
      `update public.checks set status = 'failed', failure_reason = 'persist_failed',
              finished_at = now(), progress = null where id = $1`,
      [check.checkId],
    );
    for (const name of ['built', 'map'] as const) {
      await memory.put(evidencePath(anonOwner(check), name), objectBytes(check.checkId, name));
    }
    expect(await settleKeptCheck(deps, { ...check, accountId: who.accountId })).toBe('moved');
    expect([...memory.objects.keys()].sort()).toEqual(
      pathsOf(check, who.accountId, [
        ...check.batches.map((b): EvidenceName => `batch-${b}`),
        'seeds',
        'render',
        'built',
        'map',
      ]),
    );
    expect(await storedPaths(db, check.checkId)).toEqual(
      pathsOf(
        check,
        who.accountId,
        check.batches.map((b): EvidenceName => `batch-${b}`),
      ),
    );
  });

  it('removes the copies under each stray account, by name, and leaves the keeper’s objects and other checks’', async () => {
    const memory = memoryEvidenceStore();
    const check = await storedCheck(db, memory, { host: host(), expiresAt: LATER, built: true });
    const other = await storedCheck(db, memory, { host: host(), expiresAt: LATER });
    const who = await keeper();
    const stray = await keeper();
    const { deps } = depsOf(memory);
    expect(await claimKeep(deps).keep(inputOf(check, who))).toBe('taken');
    const mine = [...memory.objects.keys()].sort();
    // What a Keep by `stray` that did not commit left: a copy of each object, `built` among them.
    for (const name of [...STORED(check), 'built'] as const) {
      const bytes = objectBytes(check.checkId, name);
      await memory.put(
        evidencePath({ ...anonOwner(check), accountId: stray.accountId }, name),
        bytes,
      );
    }
    // An object of the stray account that is not this check's stays.
    const theirs = evidencePath({ ...anonOwner(other), accountId: stray.accountId }, 'seeds');
    await memory.put(theirs, objectBytes(other.checkId, 'seeds'));

    const kept = { ...check, accountId: who.accountId };
    // The keeper's own id in the list (a Keep of the same account that lost a race) removes nothing.
    expect(await settleKeptCheck(deps, { ...kept, strays: [who.accountId, stray.accountId] })).toBe(
      'nothing',
    );
    expect([...memory.objects.keys()].sort()).toEqual([...mine, theirs].sort());
  });

  it('a stray removal that fails throws, for the caller to count', async () => {
    const memory = memoryEvidenceStore();
    const check = await storedCheck(db, memory, { host: host(), expiresAt: LATER });
    const who = await keeper();
    const stray = await keeper();
    expect(await claimKeep(depsOf(memory).deps).keep(inputOf(check, who))).toBe('taken');
    const { deps } = depsOf(failing(memory, (op) => op === 'remove'));
    await expect(
      settleKeptCheck(deps, { ...check, accountId: who.accountId, strays: [stray.accountId] }),
    ).rejects.toThrow('remove refused');
  });

  it('a failed copy changes nothing and answers failed', async () => {
    const memory = memoryEvidenceStore();
    const check = await storedCheck(db, memory, { host: host(), expiresAt: LATER });
    const who = await keeper();
    await db.query(`update public.sites set account_id = $2 where id = $1`, [
      check.siteId,
      who.accountId,
    ]);
    const { deps } = depsOf(failing(memory, (op, path) => op === 'put' && path.includes('seeds')));
    expect(await settleKeptCheck(deps, { ...check, accountId: who.accountId })).toBe('failed');
    expect(await storedPaths(db, check.checkId)).toEqual(
      pathsOf(check, null, NAMED_BY_ROWS(check)),
    );
    expect(keysUnder(memory, 'anon')).toEqual(pathsOf(check, null, STORED(check)));
  });
});

describe('at any failure, the stored paths and the objects agree (property)', () => {
  it('each stored path names an object that exists, and they are all old or all new', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          batches: fc.integer({ min: 0, max: 6 }),
          failAt: fc.integer({ min: 1, max: 30 }),
          op: fc.constantFrom('list', 'get', 'put', 'remove', 'none' as const),
          settle: fc.boolean(),
        }),
        async ({ batches, failAt, op, settle }) => {
          const memory = memoryEvidenceStore();
          const check = await storedCheck(db, memory, { host: host(), expiresAt: LATER, batches });
          const who = await keeper();
          let seen = 0;
          const flaky = failing(memory, (o) => o === op && ++seen === failAt);
          const kept = { ...check, accountId: who.accountId };
          if (settle) {
            await db.query(`update public.sites set account_id = $2 where id = $1`, [
              check.siteId,
              who.accountId,
            ]);
            await settleKeptCheck(depsOf(flaky).deps, kept).catch(() => 'threw');
          } else {
            expect(await claimKeep(depsOf(flaky).deps).keep(inputOf(check, who))).toBe('taken');
          }
          const stored = await storedPaths(db, check.checkId);
          const allOld = pathsOf(check, null, NAMED_BY_ROWS(check));
          const allNew = pathsOf(check, who.accountId, NAMED_BY_ROWS(check));
          expect([allOld, allNew]).toContainEqual(stored);
          for (const path of stored) {
            const name = path.slice(path.lastIndexOf('/') + 1, -'.json.gz'.length) as EvidenceName;
            expect(memory.objects.get(path)).toEqual(objectBytes(check.checkId, name));
          }
        },
      ),
      { numRuns: 60 },
    );
  }, 180_000);
});

describe('the move at the page cap (the budget’s measure)', () => {
  it('a 500-page check’s objects move in 47 storage calls, far inside the budget on memory', async () => {
    // CC-20b's live run of a 500-page site stored 11 crawl batches and 1 access batch
    // (notes/cc-20b/PR.md); with seeds, render and map that is 15 objects.
    const memory = memoryEvidenceStore();
    const check = await storedCheck(db, memory, { host: host(), expiresAt: LATER, batches: 12 });
    const who = await keeper();
    let calls = 0;
    const counted = failing(memory, () => {
      calls++;
      return false;
    });
    const started = performance.now();
    expect(await claimKeep(depsOf(counted).deps).keep(inputOf(check, who))).toBe('taken');
    const elapsed = performance.now() - started;
    expect(STORED(check)).toHaveLength(15);
    expect(calls).toBe(1 + 3 * 15 + 1);
    expect(elapsed).toBeLessThan(KEEP_MOVE_BUDGET_MS);
    expect(keysUnder(memory, 'anon')).toEqual([]);
  });
});
