/**
 * The walk's crawl worker (CC-38 D4). A check the app requested is finished the way the pipeline's
 * build and persist steps finish one (apps/web/lib/v2/pipeline/steps/finish.ts): the check, its site,
 * the previous graded check, the site's fixes and their events read through the pipeline's own store
 * (`supabasePipelineStore`) over the stand-in's database; `buildCheck` by the engine;
 * `persistBuiltCheck`; the map drawing stored where the finish step stores it. Only the crawl is
 * not real: its batches are the engine's recorded fixture (packages/engine/fixtures/v2/build), renamed
 * to the check and host. A re-check reads the recorded site's second crawl (`secondCrawl`), in which
 * the homepage links the planted orphan, so the first check's orphan fix resolves: the before/after.
 * No site is fetched. NOT part of the product.
 */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import type { BatchResult } from '@crawlmouse/types/v2';
import { buildCheck, checkMap } from '../../../packages/engine/src/v2/pipeline-surface';
import {
  CHECK,
  HOST,
  SITE_ID,
  recordedBuild,
} from '../../../packages/engine/fixtures/v2/build/recorded';
import { postgrestOver } from '../../../apps/web/__tests__/helpers/postgrest-pglite';
import { putJson } from '../../../apps/web/lib/v2/pipeline/evidence';
import {
  pageVantage,
  persistBuiltCheck,
  readOfFixes,
} from '../../../apps/web/lib/v2/pipeline/persist';
import { supabasePipelineStore } from '../../../apps/web/lib/v2/pipeline/store';
import { pglitePersistDb } from '../../../apps/web/lib/v2/pipeline/test-support/pglite';
import { SECOND, secondCrawl } from '../../../apps/web/lib/v2/pipeline/test-support/second-check';
import { evidencePath, type EvidenceStore } from '../../../apps/web/lib/v2/pipeline/types';
import { embeddingClient } from './embed';
import { files } from './standin';

const evidence: EvidenceStore = {
  async put(path, gzipped) {
    files.set(`evidence/${path}`, { bytes: Buffer.from(gzipped), type: 'application/gzip' });
  },
  async get(path) {
    const f = files.get(`evidence/${path}`);
    if (!f) throw new Error(`evidence: ${path} not found`);
    return new Uint8Array(f.bytes);
  },
  async remove(paths) {
    for (const p of paths) files.delete(`evidence/${p}`);
  },
};

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/**
 * The recorded batches as this check's: the recorded check and site ids and host replaced, and every
 * other id in them (an access test's, a page's) given a fresh one, the same one wherever it recurs,
 * so two checks built from the one recording do not share a row's key.
 */
function batchesFor(
  batches: BatchResult[],
  from: string,
  to: { checkId: string; siteId: string; host: string },
): BatchResult[] {
  const fresh = new Map<string, string>([
    [from, to.checkId],
    [SITE_ID, to.siteId],
  ]);
  const text = JSON.stringify(batches)
    .replace(UUID, (id) => {
      if (!fresh.has(id)) fresh.set(id, randomUUID());
      return fresh.get(id)!;
    })
    .replaceAll(HOST, `https://${to.host}`)
    .replaceAll('built-site.test', to.host);
  return JSON.parse(text) as BatchResult[];
}

/** Finishes the site's oldest queued check from the recorded crawl; its id. */
export async function finishCheck(db: PGlite, siteId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `select id from public.checks where site_id = $1 and status = 'queued'
      order by queued_at limit 1`,
    [siteId],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`walk: site ${siteId} has no queued check`);
  await db.query(
    `update public.checks set status = 'running', started_at = now(), heartbeat_at = now(),
            inngest_run_id = 'walk', progress = $2::jsonb where id = $1`,
    // The progress a running check holds, as the pipeline's tests seed one (test-support/pglite.ts).
    [
      id,
      JSON.stringify({
        steps: [{ phase: 'grading', state: 'now' }],
        pages_crawled: 0,
        pages_estimated: null,
        links_found: 0,
        elapsed_ms: 0,
        recent_fetches: [],
      }),
    ],
  );
  const store = supabasePipelineStore(embeddingClient(db, postgrestOver(db)));
  const [check, site, previous, fixes] = await Promise.all([
    store.check(id),
    store.site(siteId),
    store.previousGraded(siteId, id),
    store.fixes(siteId),
  ]);
  // As the finish step refuses one: a check the walk set running has its start time.
  if (check.started_at === null) throw new Error(`walk: check ${id} has no start time`);
  const events = await store.fixEvents(fixes.map((f) => f.id));
  const recorded = recordedBuild();
  const batches =
    previous === null
      ? batchesFor(recorded.batches as BatchResult[], CHECK, {
          checkId: id,
          siteId,
          host: site.host,
        })
      : batchesFor(secondCrawl(), SECOND, { checkId: id, siteId, host: site.host });
  const now = new Date().toISOString();
  const built = buildCheck({
    check: {
      id: check.id,
      site_id: check.site_id,
      previous_check_id: previous?.check.id ?? null,
      trigger: check.trigger,
      queued_at: check.queued_at,
      started_at: check.started_at,
      finished_at: now,
      expires_at: check.expires_at,
      page_cap: recorded.check.page_cap,
      grade_version: check.grade_version,
    },
    site,
    homepage_url: `https://${site.host}`,
    seeds: JSON.parse(JSON.stringify(recorded.seeds).replaceAll('built-site.test', site.host)),
    batches,
    render: null,
    previous,
    fixes,
    events,
    lineage: recorded.lineage,
    now,
  });
  const owner = { accountId: site.account_id, siteId, checkId: id };
  const map_path = evidencePath(owner, 'map');
  await putJson(evidence, map_path, checkMap(built.page_results, built.link_edges));
  const pages = batches.flatMap((b) => (b.kind === 'crawl' ? b.pages : []));
  await persistBuiltCheck(pglitePersistDb(db), {
    built,
    vantage: pageVantage(pages),
    map_path,
    read: readOfFixes(fixes, events),
  });
  return id;
}
