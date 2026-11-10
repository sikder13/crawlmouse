import type { PGlite } from '@electric-sql/pglite';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { MAX_RATE_LIMIT_WINDOW_MS, PRUNE_AFTER_MS } from '../lib/rate-limit-window';
import {
  applyAllMigrations,
  asRole,
  freshDb,
  migrationFiles,
  readMigration,
  readRollback,
} from './helpers/pglite-migrations';

// B-F1: public.prune_rate_limits deletes rows whose window has ended, and never one inside its own
// window. PGlite cannot move now(), so each case inserts window_start relative to now() and prunes
// in the same transaction, where now() does not change.

const FILE = migrationFiles().find((f) => f.endsWith('_rate_limits_prune.sql'))!;
const ROLLBACK = FILE.replace(/\.sql$/, '.revert.sql');

let db: PGlite;
beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
}, 300_000);

/** Inserts one row per age (ms before now()), prunes, and returns the ages whose rows survived. */
async function survivors(agesMs: number[], limit = 5000): Promise<number[]> {
  return db.transaction(async (tx) => {
    await tx.exec('delete from public.rate_limits');
    for (const [i, age] of agesMs.entries()) {
      await tx.query(
        `insert into public.rate_limits (bucket_key, window_start, request_count)
         values ($1, now() - make_interval(secs => $2::double precision / 1000), 1)`,
        [`k:${i}`, age],
      );
    }
    await tx.exec('set local role service_role');
    await tx.query('select public.prune_rate_limits($1)', [limit]);
    await tx.exec('reset role');
    const { rows } = await tx.query<{ bucket_key: string }>(
      'select bucket_key from public.rate_limits',
    );
    const left = new Set(rows.map((r) => r.bucket_key));
    const out = agesMs.filter((_, i) => left.has(`k:${i}`));
    await tx.rollback();
    return out;
  });
}

describe('prune_rate_limits (B-F1)', () => {
  it('states the same cutoff as PRUNE_AFTER_MS, the longest window plus an hour', () => {
    expect(readMigration(FILE)).toContain(`interval '25 hours'`);
    expect(PRUNE_AFTER_MS).toBe(25 * 60 * 60 * 1000);
    expect(PRUNE_AFTER_MS - MAX_RATE_LIMIT_WINDOW_MS).toBe(60 * 60 * 1000);
  });

  it('keeps a row exactly at the cutoff and deletes one a millisecond past it', async () => {
    expect(await survivors([PRUNE_AFTER_MS, PRUNE_AFTER_MS + 1])).toEqual([PRUNE_AFTER_MS]);
  });

  it("keeps global:audits:day's window through its day and the hour after, then deletes it", async () => {
    const H = 60 * 60 * 1000;
    // The day window opened 23h59m ago (still open), 24h59m ago (ended 59 minutes ago), 25h01m ago.
    const ages = [23 * H + 59 * 60_000, 24 * H + 59 * 60_000, 25 * H + 60_000];
    expect(await survivors(ages)).toEqual(ages.slice(0, 2));
  });

  it('never deletes a row whose window, of any allowed length, is still open', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: MAX_RATE_LIMIT_WINDOW_MS }), { maxLength: 8 }),
        fc.array(fc.integer({ min: PRUNE_AFTER_MS + 1, max: 40 * MAX_RATE_LIMIT_WINDOW_MS }), {
          maxLength: 8,
        }),
        async (open, old) => {
          expect((await survivors([...open, ...old])).sort()).toEqual([...open].sort());
        },
      ),
      { numRuns: 40 },
    );
  }, 120_000);

  it('deletes at most p_limit rows, never more than 5000, and none for a negative limit', async () => {
    const counts = await db.transaction(async (tx) => {
      await tx.exec('delete from public.rate_limits');
      await tx.exec(`insert into public.rate_limits (bucket_key, window_start, request_count)
        select 'old:' || g, now() - interval '30 days' - g * interval '1 second', 1
        from generate_series(1, 5007) g`);
      await tx.exec('set local role service_role');
      const run = async (n: number) =>
        (await tx.query<{ n: number }>('select public.prune_rate_limits($1) as n', [n])).rows[0]!.n;
      const out = [
        await run(-5),
        await run(3),
        await run(100_000),
        await run(5000),
        await run(5000),
      ];
      await tx.rollback();
      return out;
    });
    // -5 deletes none; 3 deletes 3; 100000 is capped at 5000; the last 4; then nothing is left.
    expect(counts).toEqual([0, 3, 5000, 4, 0]);
  }, 120_000);

  it('deletes the oldest rows first', async () => {
    const H = 60 * 60 * 1000;
    expect(await survivors([30 * H, 90 * H, 60 * H], 1)).toEqual([30 * H, 60 * H]);
  });

  it('is executable by service_role only', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      await expect(
        asRole(db, role, null, (tx) => tx.query('select public.prune_rate_limits(1)')),
      ).rejects.toThrow(/permission denied/);
    }
    await expect(
      asRole(db, 'service_role', null, (tx) => tx.query('select public.prune_rate_limits(1)')),
    ).resolves.toBeDefined();
    const { rows } = await db.query<{ setting: string[]; definer: boolean }>(
      `select proconfig as setting, prosecdef as definer from pg_proc
        where oid = 'public.prune_rate_limits(integer)'::regprocedure`,
    );
    expect(rows[0]).toEqual({ setting: ['search_path=pg_catalog, pg_temp'], definer: false });
  });

  it('prunes public.rate_limits even when a temporary table of that name exists', async () => {
    const left = await db.transaction(async (tx) => {
      await tx.exec('delete from public.rate_limits');
      await tx.exec(`insert into public.rate_limits values ('old', now() - interval '3 days', 1)`);
      await tx.exec(`create temporary table rate_limits (bucket_key text, window_start timestamptz)
        on commit drop`);
      await tx.exec(`set local role service_role`);
      await tx.query('select public.prune_rate_limits(10)');
      await tx.exec('reset role');
      const { rows } = await tx.query('select 1 from public.rate_limits');
      await tx.rollback();
      return rows.length;
    });
    expect(left).toBe(0);
  });

  it('can be applied twice, and its rollback twice, without an error', async () => {
    const twice = await freshDb();
    await applyAllMigrations(twice);
    await twice.exec(readMigration(FILE));
    const priv = async () =>
      (
        await twice.query<{ anon: boolean; auth: boolean; svc: boolean }>(
          `select has_function_privilege('anon', 'public.prune_rate_limits(integer)', 'execute') as anon,
                  has_function_privilege('authenticated', 'public.prune_rate_limits(integer)', 'execute') as auth,
                  has_function_privilege('service_role', 'public.prune_rate_limits(integer)', 'execute') as svc`,
        )
      ).rows[0];
    expect(await priv()).toEqual({ anon: false, auth: false, svc: true });
    await twice.exec(readRollback(ROLLBACK));
    await twice.exec(readRollback(ROLLBACK));
    const { rows } = await twice.query(`select 1 from pg_proc where proname = 'prune_rate_limits'`);
    expect(rows).toEqual([]);
    await twice.close();
  }, 300_000);
});
