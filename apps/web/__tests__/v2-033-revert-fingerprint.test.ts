/**
 * CC-33: the revert of 20261115000001 gives back the schema the migration found, as the project's
 * own fingerprint reads it (`infra/supabase/checks/fingerprint.sql`). The migration dry run fails
 * unless the fingerprint after the rollbacks equals production's (`docs/ops/db-migrations.md`), and
 * the fingerprint holds each function's text, so a function rebuilt in other words is a difference.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyAllMigrations,
  freshDb,
  MIGRATIONS_DIR,
  readMigration,
  readRollback,
} from './helpers/pglite-migrations';

const MIGRATION = '20261115000001_v2_033_operations.sql';
const ROLLBACK = '20261115000001_v2_033_operations.revert.sql';
const FINGERPRINT = readFileSync(resolve(MIGRATIONS_DIR, '../checks/fingerprint.sql'), 'utf8');

let db: PGlite;
beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db, undefined, (f) => f < MIGRATION);
}, 600_000);
afterAll(async () => db?.close());

type Sections = Record<string, string>;
const read = async (): Promise<Sections> =>
  Object.fromEntries(
    (await db.query<{ section: string; md5: string }>(FINGERPRINT)).rows.map((r) => [
      r.section,
      r.md5,
    ]),
  );
const differing = (a: Sections, b: Sections) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((s) => a[s] !== b[s]).sort();

/** The kinds `email_sends.kind` allows, in the constraint's order. */
const kinds = async () =>
  [
    ...(
      await db.query<{ def: string }>(
        `select pg_get_constraintdef(oid) def from pg_constraint where conname = 'email_sends_kind_check'`,
      )
    ).rows[0]!.def.matchAll(/'([a-z_]+)'::text/g),
  ].map((m) => m[1]);

describe('the revert of 20261115000001', () => {
  it('leaves each section of the fingerprint as the migration found it, and the migration applied again gives its own back', async () => {
    const before = await read();
    // The state it is applied to is production's order: CC-31's 20261114000002 is in it, with the
    // three kinds that migration added to the mail ledger.
    const kindsBefore = await kinds();
    expect(kindsBefore).toEqual(expect.arrayContaining(['agency_plus_contact', 'client_report']));
    await db.exec(readMigration(MIGRATION));
    expect(await kinds()).toEqual([...kindsBefore, 'founder_event', 'founder_digest']);
    const applied = await read();
    // The comparison is of something: the fingerprint has sections, and the migration moves some.
    expect(Object.keys(before).length).toBeGreaterThan(0);
    expect(differing(before, applied).length).toBeGreaterThan(0);

    await db.exec(readRollback(ROLLBACK));
    expect(differing(before, await read())).toEqual([]);
    expect(await kinds()).toEqual(kindsBefore);

    await db.exec(readMigration(MIGRATION));
    expect(differing(applied, await read())).toEqual([]);
  });
});
