import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  failCheck,
  seedMemberRead,
  visibleRows,
  type MemberReadScenario,
} from '../lib/v2/pipeline/test-support/member-read';
import { applyAllMigrations, asRole, freshDb } from './helpers/pglite-migrations';

/**
 * Migration 20261125000001 (V2R A2, inbox 124): a member reads a check's page rows and link edges
 * through the Data API only once the check is finished or partial. Run on PGlite with every
 * migration; scripts/db/member-read-finished.test.ts runs the same scenario on a real Postgres.
 * The control applies the revert and shows the member reading the running check's rows again, so
 * the test tells the two policies apart.
 */

const REVERT = join(
  __dirname,
  '../../../infra/supabase/rollbacks/20261125000001_v2_a2_member_read_finished.revert.sql',
);

let base: PGlite;
beforeAll(async () => {
  base = await freshDb();
  await applyAllMigrations(base);
}, 180_000);

let db: PGlite;
let s: MemberReadScenario;
beforeEach(async () => {
  db = (await base.clone()) as PGlite;
  s = await seedMemberRead(db);
}, 120_000);
afterEach(async () => {
  await db.close();
});

const asMember = (checkId: string) =>
  asRole(db, 'authenticated', s.userId, (tx) => visibleRows(tx, checkId));

describe('a member’s read of page_results and link_edges (migration 20261125000001)', () => {
  it('reads every row of a finished check of their site', async () => {
    expect(await asMember(s.finishedId)).toEqual(s.rows);
  });

  it('reads no row of a running check of their site, which holds rows', async () => {
    expect(await visibleRows(db, s.runningId), 'anti-vacuity: the superuser sees them').toEqual(
      s.rows,
    );
    expect(await asMember(s.runningId)).toEqual({ page_results: 0, link_edges: 0 });
  });

  it('reads no row of a check whose save failed', async () => {
    await failCheck(db, s.runningId);
    expect(await visibleRows(db, s.runningId)).toEqual(s.rows);
    expect(await asMember(s.runningId)).toEqual({ page_results: 0, link_edges: 0 });
  });

  it('control: with the migration reverted, the member reads the running check’s rows again', async () => {
    await db.exec(readFileSync(REVERT, 'utf8'));
    expect(await asMember(s.runningId)).toEqual(s.rows);
  });
});
