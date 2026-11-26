/**
 * The member-read scenario for migration 20261125000001 (V2R A2, inbox 124), shared by its PGlite
 * test (apps/web/__tests__/v2-a2-member-read-finished.test.ts) and its real-Postgres one
 * (scripts/db/member-read-finished.test.ts): one member of one site, a finished check of that site
 * with its rows, and a second check of the site holding page rows and edges while it runs, as the
 * pipeline leaves a check between its row pieces and its finishing call (F-330).
 */
import { randomUUID } from 'node:crypto';
import { buildCheck } from '@crawlmouse/engine/v2/pipeline';
import type { BatchResult, CrawlPage } from '@crawlmouse/types/v2';
import { recordedBuild } from '../../../../../../packages/engine/fixtures/v2/build/recorded';
import { personalAccount, signUp } from '../../../../__tests__/helpers/v2-check-tables';
import { pageVantage, persistBuiltCheck } from '../persist';
import type { PersistInput } from '../types';
import { pglitePersistDb, seedRunning, seedSite } from './pglite';

type Db = Parameters<typeof seedSite>[0];

export interface MemberReadScenario {
  userId: string;
  finishedId: string;
  /** Running, with page rows and edges written and the check not finished. */
  runningId: string;
  /** What each check stores, as the superuser counts it. */
  rows: { page_results: number; link_edges: number };
}

export async function seedMemberRead(db: Db): Promise<MemberReadScenario> {
  const userId = await signUp(db, `member-${randomUUID()}@example.test`);
  const { accountId } = await personalAccount(db, userId);
  const input = recordedBuild();
  const built = buildCheck(input);
  const crawl = (input.batches as BatchResult[]).flatMap((b) =>
    b.kind === 'crawl' ? b.pages : [],
  ) as CrawlPage[];
  const vantage = pageVantage(crawl);
  await seedSite(db, { ...input.site, account_id: accountId });
  const pdb = pglitePersistDb(db);
  const persistInput = (b: typeof built): PersistInput => ({
    built: b,
    vantage,
    map_path: `${accountId}/${b.check.site_id}/${b.check.id}/map.json.gz`,
    read: [],
  });

  // The finished check.
  await seedRunning(db, { ...input.check, id: built.check.id });
  const finished = await persistBuiltCheck(pdb, persistInput(built));
  if (!finished.written) throw new Error('seedMemberRead: the finished check was not written');

  // The running one: a check of the same site and month holding the same rows, as the pipeline's
  // row pieces leave a check before its finishing call. Copied by the superuser, so this does not
  // depend on the persist port's shape.
  const runningId = randomUUID();
  await seedRunning(db, { ...input.check, id: runningId });
  for (const table of ['page_results', 'link_edges']) {
    await db.query(
      `insert into public.${table}
       select (jsonb_populate_record(null::public.${table},
                                     to_jsonb(r) || jsonb_build_object('check_id', $2::uuid))).*
         from public.${table} r where r.check_id = $1`,
      [built.check.id, runningId],
    );
  }
  return {
    userId,
    finishedId: built.check.id,
    runningId,
    rows: { page_results: built.page_results.length, link_edges: built.link_edges.length },
  };
}

/** The check's page rows and edges as the querying role sees them. */
export async function visibleRows(
  db: Db,
  checkId: string,
): Promise<{ page_results: number; link_edges: number }> {
  const { rows } = await db.query<{ page_results: number; link_edges: number }>(
    `select (select count(*)::int from public.page_results where check_id = $1) as page_results,
            (select count(*)::int from public.link_edges where check_id = $1) as link_edges`,
    [checkId],
  );
  return rows[0]!;
}

/** Marks the check failed, as the pipeline's fail step leaves a check whose save failed. */
export async function failCheck(db: Db, checkId: string): Promise<void> {
  await db.query(
    `update public.checks set status = 'failed', failure_reason = 'persist_failed',
            finished_at = now(), progress = null
      where id = $1`,
    [checkId],
  );
}
