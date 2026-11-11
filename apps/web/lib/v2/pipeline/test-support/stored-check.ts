/**
 * Checks with stored evidence, for the keep and expiry tests: rows in PGlite and objects in an
 * evidence store, written as the pipeline's steps leave them (a done batch's `result_path`, the
 * check's `map_path`, and the `seeds`, `render`, `map` and `batch-{n}` objects under the check's
 * directory).
 */
import type { PGlite } from '@electric-sql/pglite';
import { buildCheck, checkMap, type BuiltCheck } from '@crawlmouse/engine/v2/pipeline';
import type { BatchResult } from '@crawlmouse/types/v2';
import { recordedBuild } from '../../../../../../packages/engine/fixtures/v2/build/recorded';
import { asRole } from '../../../../__tests__/helpers/pglite-migrations';
import { gzipJson } from '../evidence';
import { pageVantage, persistBuiltCheck, readOfFixes } from '../persist';
import { evidencePath, type EvidenceName, type EvidenceOwner, type EvidenceStore } from '../types';
import { pglitePersistDb, seedRunning, seedSite } from './pglite';
import type { RunSql } from './sql-keep-store';

/** Each store call as one transaction as the service role, as each PostgREST request is. */
export const asService =
  (db: PGlite): RunSql =>
  (fn) =>
    asRole(db, 'service_role', null, fn);

export interface StoredCheck {
  siteId: string;
  checkId: string;
  batches: number[];
}

export type StoredStatus = 'queued' | 'running' | 'failed';

const NONCE = 'nonce-nonce-nonce-0000';

/** The bytes the fixture stores for `name` of a check: distinct per object. */
export const objectBytes = (checkId: string, name: EvidenceName): Uint8Array =>
  new Uint8Array(gzipJson({ check: checkId, object: name }));

export const anonOwner = (c: Pick<StoredCheck, 'siteId' | 'checkId'>): EvidenceOwner => ({
  accountId: null,
  siteId: c.siteId,
  checkId: c.checkId,
});

/**
 * An unkept site and one check of it in `status`, with `batches` done batches and their objects,
 * `seeds` and `render`; an ended check also has its `map` object and `map_path`. `built` adds the
 * scratch object a check that failed after build leaves.
 */
export async function storedCheck(
  db: PGlite,
  evidence: EvidenceStore,
  opts: {
    host: string;
    expiresAt: Date | null;
    status?: StoredStatus;
    batches?: number;
    built?: boolean;
  },
): Promise<StoredCheck> {
  const status = opts.status ?? 'failed';
  const site = await db.query<{ id: string }>(
    `insert into public.sites (host) values ($1) returning id`,
    [opts.host],
  );
  const siteId = site.rows[0]!.id;
  const inserted = await db.query<{ id: string }>(
    status === 'queued'
      ? `insert into public.checks (site_id, status, trigger, grade_version, expires_at)
         values ($1, 'queued', 'first_audit', '2.0.0', $2) returning id`
      : status === 'running'
        ? `insert into public.checks (site_id, status, trigger, grade_version, expires_at,
                                      started_at, progress, inngest_run_id, heartbeat_at)
           values ($1, 'running', 'first_audit', '2.0.0', $2, now(),
                   '{"steps":[],"pages_crawled":0,"pages_estimated":null,"links_found":0,"elapsed_ms":0,"recent_fetches":[]}'::jsonb,
                   'run-' || gen_random_uuid(), now())
           returning id`
        : `insert into public.checks (site_id, status, trigger, grade_version, expires_at,
                                      started_at, finished_at, failure_reason)
           values ($1, 'failed', 'first_audit', '2.0.0', $2, now(), now(), 'persist_failed')
           returning id`,
    [siteId, opts.expiresAt],
  );
  const check: StoredCheck = {
    siteId,
    checkId: inserted.rows[0]!.id,
    batches: Array.from({ length: opts.batches ?? 2 }, (_, i) => i),
  };
  const owner = anonOwner(check);
  const put = (name: EvidenceName) =>
    evidence.put(evidencePath(owner, name), objectBytes(check.checkId, name));
  for (const n of check.batches) {
    await db.query(
      `insert into public.crawl_batches (check_id, batch, kind, nonce, status, posted_at,
                                         finished_at, result_path)
       values ($1, $2, 'crawl', $3, 'done', now(), now(), $4)`,
      [check.checkId, n, NONCE, evidencePath(owner, `batch-${n}`)],
    );
    await put(`batch-${n}`);
  }
  await put('seeds');
  await put('render');
  if (status === 'failed') {
    await put('map');
    await db.query(`update public.checks set map_path = $2 where id = $1`, [
      check.checkId,
      evidencePath(owner, 'map'),
    ]);
  }
  if (opts.built) await put('built');
  return check;
}

/**
 * The engine's recorded site, built, persisted as a finished check of an unkept site and stored as
 * the pipeline stores it: each recorded batch as a done batch with its result object, the seeds,
 * and the map drawing at `map_path`.
 */
export async function recordedStoredCheck(
  db: PGlite,
  evidence: EvidenceStore,
  expiresAt: string,
): Promise<StoredCheck & { built: BuiltCheck }> {
  const recorded = recordedBuild();
  const input = { ...recorded, check: { ...recorded.check, expires_at: expiresAt } };
  const built = buildCheck(input);
  const check: StoredCheck = {
    siteId: input.site.id,
    checkId: input.check.id,
    batches: input.batches.map((_, i) => i),
  };
  const owner = anonOwner(check);
  await seedSite(db, input.site);
  await seedRunning(db, input.check);
  await evidence.put(evidencePath(owner, 'seeds'), gzipJson(input.seeds));
  for (const [n, batch] of (input.batches as BatchResult[]).entries()) {
    const path = evidencePath(owner, `batch-${n}`);
    await evidence.put(path, gzipJson(batch));
    await db.query(
      `insert into public.crawl_batches (check_id, batch, kind, nonce, status, posted_at,
                                         finished_at, result_path)
       values ($1, $2, $3, $4, 'done', now(), now(), $5)`,
      [check.checkId, n, batch.kind, NONCE, path],
    );
  }
  const mapPath = evidencePath(owner, 'map');
  await evidence.put(mapPath, gzipJson(checkMap(built.page_results, built.link_edges)));
  await persistBuiltCheck(pglitePersistDb(db), {
    built,
    vantage: pageVantage(
      (input.batches as BatchResult[]).flatMap((b) => (b.kind === 'crawl' ? b.pages : [])),
    ),
    map_path: mapPath,
    read: readOfFixes(input.fixes, input.events),
  });
  return { ...check, built };
}

/** Every stored evidence path of a check: its batches' `result_path`s and its `map_path`. */
export async function storedPaths(db: PGlite, checkId: string): Promise<string[]> {
  const { rows } = await db.query<{ path: string }>(
    `select result_path as path from public.crawl_batches
      where check_id = $1 and result_path is not null
     union all
     select map_path from public.checks where id = $1 and map_path is not null
     order by 1`,
    [checkId],
  );
  return rows.map((r) => r.path);
}

export async function siteAccount(db: PGlite, siteId: string): Promise<string | null> {
  const { rows } = await db.query<{ account_id: string | null }>(
    `select account_id from public.sites where id = $1`,
    [siteId],
  );
  return rows[0]?.account_id ?? null;
}
