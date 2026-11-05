import { describe, expect, it } from 'vitest';
import { compareFingerprints, readFingerprint } from './fingerprint';
import { listMigrations } from './files';
import {
  FORGET_VERSION,
  migrationForRollback,
  missingRollbacks,
  LOCK_HISTORY,
  TAKE_DB_OPS_LOCK,
  newestFirstGuard,
  rerun,
  revert,
} from './rollback';
import { HISTORY_TABLE, migratedDb, pgliteDb } from './test-support';

const PENDING = ['20261102000001', '20261102000002', '20261102000003', '20261103000001'];
const migrations = listMigrations();
const pending = migrations.filter((m) => PENDING.includes(m.version));

/** A database migrated through 001, and one with 003, 005, 007 and 006b applied after it. */
async function databases() {
  const before = await migratedDb((f) => f.slice(0, 14) <= '20261101000001');
  const after = await migratedDb();
  for (const pg of [before, after]) await pg.exec(HISTORY_TABLE);
  for (const m of pending) {
    await after.query(
      'insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)',
      [m.version, m.name, [m.sql]],
    );
  }
  return { before: pgliteDb(before), after: pgliteDb(after) };
}

describe('every pending migration has a rollback', () => {
  it('finds none missing for 003, 005, 007 and 006b', () => {
    expect(pending).toHaveLength(4);
    expect(missingRollbacks(pending)).toEqual([]);
  });

  it('reports a migration without one', () => {
    const fake = { ...pending[0]!, file: '20991231000000_no_rollback.sql' };
    expect(missingRollbacks([fake])).toEqual([fake]);
  });
});

describe('revert and rerun', () => {
  it('re-running the pending files changes nothing, and reverting them in reverse order returns the catalog to production', async () => {
    const { before, after } = await databases();
    const production = await readFingerprint(before);
    const applied = await readFingerprint(after);

    await rerun(after, pending, () => {});
    expect(compareFingerprints(applied, await readFingerprint(after))).toEqual([]);

    await revert(after, [...pending].reverse(), () => {});
    expect(compareFingerprints(production, await readFingerprint(after))).toEqual([]);
    const rows = await after.query<{ version: string }>(
      'select version from supabase_migrations.schema_migrations',
    );
    expect(rows.map((r) => r.version).filter((v) => PENDING.includes(v))).toEqual([]);
  }, 240_000);

  it('a revert that fails leaves the schema and the history row as they were', async () => {
    const { after } = await databases();
    await after.exec(
      `insert into storage.objects (bucket_id, name) values ('evidence', 'kept.json.gz')`,
    );
    const m007 = pending.find((m) => m.version === '20261102000003')!;
    const m006b = pending.find((m) => m.version === '20261103000001')!;
    await revert(after, [m006b], () => {});
    const fp = await readFingerprint(after);
    await expect(revert(after, [m007], () => {})).rejects.toThrow(/still hold objects/);
    const rows = await after.query<{ version: string }>(
      'select version from supabase_migrations.schema_migrations where version = $1',
      [m007.version],
    );
    expect(rows).toHaveLength(1);
    expect(compareFingerprints(fp, await readFingerprint(after))).toEqual([]);
  }, 240_000);

  it('refuses to revert a migration the history does not record, and changes nothing', async () => {
    const { before } = await databases();
    const fp = await readFingerprint(before);
    const m005 = pending.find((m) => m.version === '20261102000002')!;
    await expect(revert(before, [m005], () => {})).rejects.toThrow(/is not recorded as applied/);
    expect(compareFingerprints(fp, await readFingerprint(before))).toEqual([]);
    expect(FORGET_VERSION).toContain('returning version');
  }, 240_000);
});

describe('newestFirstGuard, inside the rollback transaction', () => {
  it('refuses a migration that is no longer the newest recorded, and changes nothing', async () => {
    const { after } = await databases();
    const fp = await readFingerprint(after);
    const m007 = pending.find((m) => m.version === '20261102000003')!;
    await expect(revert(after, [m007], () => {}, newestFirstGuard)).rejects.toThrow(
      '20261103000001 is newer than 20261102000003 and still applied: roll back newest first',
    );
    expect(compareFingerprints(fp, await readFingerprint(after))).toEqual([]);
  }, 240_000);

  it("takes the apply's advisory lock before it locks and reads the history", async () => {
    const { after } = await databases();
    const m006b = pending.find((m) => m.version === '20261103000001')!;
    after.executed.length = 0;
    await revert(after, [m006b], () => {}, newestFirstGuard);
    const advisory = after.executed.indexOf(TAKE_DB_OPS_LOCK);
    expect(advisory).toBeGreaterThanOrEqual(0);
    expect(advisory).toBeLessThan(after.executed.indexOf(LOCK_HISTORY));
  }, 240_000);

  it('lets the newest recorded migration revert', async () => {
    const { after } = await databases();
    const m006b = pending.find((m) => m.version === '20261103000001')!;
    await revert(after, [m006b], () => {}, newestFirstGuard);
    const rows = await after.query<{ version: string }>(
      'select version from supabase_migrations.schema_migrations where version = $1',
      [m006b.version],
    );
    expect(rows).toEqual([]);
  }, 240_000);
});

describe('migrationForRollback', () => {
  it('accepts a tracked rollback and names its migration', () => {
    expect(migrationForRollback('20261102000003_v2_007_storage.revert.sql').version).toBe(
      '20261102000003',
    );
  });

  it.each([
    ['../migrations/20261102000003_v2_007_storage.sql', /is not named/],
    ['20261102000003_v2_007_storage.revert.sql; drop table x', /is not named/],
    ['20261102000003_v2_007_storag.revert.sql', /matches no migration/],
    ['20260524000001_init_users.revert.sql', /is not in infra\/supabase\/rollbacks/],
  ])('refuses %s', (file, error) => {
    expect(() => migrationForRollback(file)).toThrow(error);
  });
});
