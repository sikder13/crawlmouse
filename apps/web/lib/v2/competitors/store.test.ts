/**
 * Row 18: the competitor store over the service-role client, run against a PostgREST stand-in over
 * PGlite with every migration applied. The finished check is the engine's recorded site, persisted
 * as the pipeline persists it (recordedStoredCheck), so every column carries a real shape.
 */
import type { PGlite } from '@electric-sql/pglite';
import { CompetitorSnapshotSchema, type CompetitorSnapshot } from '@crawlmouse/types/v2';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { postgrestOver } from '../../../__tests__/helpers/postgrest-pglite';
import { accountOf, count, doorDb, signUp } from '../../../__tests__/v2/_lib/door-pglite';
import { checkFromRow } from '../pipeline/rows';
import { memoryEvidenceStore } from '../pipeline/test-support/memory-evidence';
import { recordedStoredCheck, storedCheck } from '../pipeline/test-support/stored-check';
import { supabaseCompetitorStore } from './store';

const LATER = '2099-01-01T00:00:00.000Z';
const SITE = 'c0000000-0000-4000-8000-0000000000a1';

const snap = (host: string): CompetitorSnapshot =>
  CompetitorSnapshotSchema.parse({
    host,
    crawlers_with_access: 4,
    crawlers_tested: 6,
    text_share: null,
    product_schema: null,
    technical_seo: { score: 72, grade: 'B-' },
    ai_readability: null,
    signals_present: 2,
  });

let db: PGlite;
beforeEach(async () => {
  db = await doorDb();
}, 120_000);
afterEach(async () => {
  await db?.close();
});

const store = () => supabaseCompetitorStore(postgrestOver(db));

/** The recorded check, its site kept by a new account with `limit` competitors and `hosts`. */
async function keptFinished(hosts: string[], limit: number) {
  const c = await recordedStoredCheck(db, memoryEvidenceStore(), LATER);
  const account = await accountOf(db, await signUp(db, 'owner@example.test'));
  await db.query(`update public.accounts set competitor_limit = $2 where id = $1`, [
    account.id,
    limit,
  ]);
  await db.query(`update public.sites set account_id = $2, competitor_hosts = $3 where id = $1`, [
    c.siteId,
    account.id,
    hosts,
  ]);
  return c;
}

describe('planRow', () => {
  it("reads the check's status, its site and its account's competitor limit", async () => {
    const c = await keptFinished(['rival.example'], 1);
    const host = (
      await db.query<{ host: string }>(`select host from public.sites where id = $1`, [c.siteId])
    ).rows[0]!.host;
    expect(await store().planRow(c.checkId)).toEqual({
      checkStatus: 'finished',
      siteId: c.siteId,
      host,
      kept: true,
      staging: false,
      removed: false,
      paused: false,
      competitorHosts: ['rival.example'],
      competitorLimit: 1,
    });
  });

  it('reads a site no account keeps as unkept, with no limit', async () => {
    const c = await recordedStoredCheck(db, memoryEvidenceStore(), LATER);
    expect(await store().planRow(c.checkId)).toMatchObject({ kept: false, competitorLimit: 0 });
  });

  it('answers null for a check that is not there', async () => {
    expect(await store().planRow('c0000000-0000-4000-8000-00000000dead')).toBeNull();
  });
});

describe('latestEnded and endedCheck', () => {
  it("names the site's latest finished check and reads it whole", async () => {
    const c = await recordedStoredCheck(db, memoryEvidenceStore(), LATER);
    const latest = await store().latestEnded(c.siteId);
    expect(latest?.checkId).toBe(c.checkId);
    expect(Date.parse(latest!.finishedAt)).toBe(Date.parse(c.built.check.finished_at!));
    const read = await store().endedCheck(c.checkId);
    expect(read?.id).toBe(c.checkId);
    expect(read?.technical_seo).toEqual(c.built.check.technical_seo);
  });

  it('passes over a failed check, and reads none back', async () => {
    const failed = await storedCheck(db, memoryEvidenceStore(), {
      host: 'failed.example',
      expiresAt: new Date(LATER),
    });
    expect(await store().latestEnded(failed.siteId)).toBeNull();
    expect(await store().endedCheck(failed.checkId)).toBeNull();
  });
});

describe('endedOf', () => {
  it('names the checks that finished or failed, and not one still running', async () => {
    const ev = memoryEvidenceStore();
    const done = await recordedStoredCheck(db, ev, LATER);
    const failed = await storedCheck(db, ev, { host: 'f.example', expiresAt: new Date(LATER) });
    const running = await storedCheck(db, ev, {
      host: 'r.example',
      expiresAt: new Date(LATER),
      status: 'running',
    });
    const ids = [done.checkId, failed.checkId, running.checkId];
    expect((await store().endedOf(ids)).sort()).toEqual([done.checkId, failed.checkId].sort());
  });
});

describe('ensureSite', () => {
  it('inserts a site no account keeps once, under the id it is given', async () => {
    await store().ensureSite(SITE, 'rival.example');
    await store().ensureSite(SITE, 'rival.example');
    const { rows } = await db.query(`select host, account_id from public.sites where id = $1`, [
      SITE,
    ]);
    expect(rows).toEqual([{ host: 'rival.example', account_id: null }]);
  });
});

describe('writeCompetitors', () => {
  it('writes the snapshots to an ended check, which reads them back in order', async () => {
    const c = await keptFinished(['a.example', 'b.example'], 3);
    expect(await store().writeCompetitors(c.checkId, [snap('a.example'), snap('b.example')])).toBe(
      true,
    );
    const { rows } = await db.query<{ row: Record<string, unknown> }>(
      `select to_jsonb(c) as row from public.checks c where id = $1`,
      [c.checkId],
    );
    expect(checkFromRow(rows[0]!.row).competitors).toEqual([snap('a.example'), snap('b.example')]);
  });

  it('changes nothing else of the check', async () => {
    const c = await keptFinished(['a.example'], 1);
    const before = (
      await db.query<{ row: Record<string, unknown> }>(
        `select to_jsonb(c) - 'competitors' as row from public.checks c where id = $1`,
        [c.checkId],
      )
    ).rows[0]!.row;
    await store().writeCompetitors(c.checkId, [snap('a.example')]);
    const after = (
      await db.query<{ row: Record<string, unknown> }>(
        `select to_jsonb(c) - 'competitors' as row from public.checks c where id = $1`,
        [c.checkId],
      )
    ).rows[0]!.row;
    expect(after).toEqual(before);
  });

  it('writes nothing to a check that has not ended', async () => {
    const running = await storedCheck(db, memoryEvidenceStore(), {
      host: 'running.example',
      expiresAt: new Date(LATER),
      status: 'running',
    });
    expect(await store().writeCompetitors(running.checkId, [snap('a.example')])).toBe(false);
    expect(
      await count(db, `select 1 from public.checks where id = $1 and competitors <> '[]'`, [
        running.checkId,
      ]),
    ).toBe(0);
  });
});
