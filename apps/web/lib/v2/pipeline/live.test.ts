/**
 * D14, the live run: a check of a real site through the deployed staging worker, with the pipeline's
 * own steps and orchestration (`runCheck` over `checkSteps`) over functions.ts `stepDeps`, the builder
 * production calls. What differs from production:
 *
 * - the store implementation: `sqlPipelineStore` over PGlite with every migration, where production
 *   runs `supabasePipelineStore` over PostgREST; persistence writes to the same PGlite;
 * - the evidence store: a bucket in memory, where production uses Storage;
 * - the environment: this process's, with VERCEL_GIT_COMMIT_SHA set to the commit under test;
 * - the step tools: each step body runs once, as it is reached, with no memoisation, no retries and
 *   no replays, and each sleep is a real wait; checkFn's onFailure and the cancel handler do not run.
 *
 * Nothing here reads or writes production data.
 *
 * Skipped, not failed, unless the three worker values are in the environment, as the operator keeps
 * them in the gitignored scripts/.env.local:
 *
 *   set -a; . scripts/.env.local; set +a
 *   LIVE_OUT=<file> pnpm --filter @crawlmouse/web exec vitest run lib/v2/pipeline/live.test.ts
 *
 * Each host's summary (pages, batches, step timings, findings) is printed and, with LIVE_OUT, appended
 * to that file as one JSON line. Neither carries a credential: the summary is built from counts,
 * step ids and the site's own URLs.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { runCheck, type CheckStepTools, type DiscoverOutput } from '../../../../../inngest/check';
import type { CheckRequested } from '../../../../../inngest/check-events';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { stepDeps } from './functions';
import { loadCheck } from './load';
import { requestCheck } from './request';
import { checkSteps } from './steps';
import { memoryEvidenceStore } from './test-support/memory-evidence';
import { pgliteCheckReader, pglitePersistDb } from './test-support/pglite';
import { sqlPipelineStore } from './test-support/sql-store';

// The billing functions (CC-03) load modules that import 'server-only', which throws outside Next.
vi.mock('server-only', () => ({}));

const env = process.env;
const configured = ['CRAWL_WORKER_URL', 'WORKER_SIGNING_SECRET', 'WORKER_JWT_PRIVATE_KEY_PKCS8_B64']
  .map((k) => env[k])
  .every((v) => typeof v === 'string' && v.length > 0);

/**
 * The JS shell does not exercise D8 (no orphan or deep-page finding on a site served for JavaScript to
 * fill in): in the recorded runs (2026-11-08) its homepage was the only page crawled. It has no links,
 * and its sitemap's nine URLs are on `alynthe.com` while the site is `www.alynthe.com`, a host the
 * planner does not seed (CC-20a's `crawlableSeeds`; a recorded follow-up). D8 is proven on the engine
 * fixtures. A run's summary carries `d8` when its own counts show that shape.
 */
const HOSTS = [
  { host: 'books.toscrape.com', shape: 'static' },
  { host: 'www.alynthe.com', shape: 'client-rendered shell (CC-12b smoke)' },
] as const;

/** The commit under test: the lineage's engine_sha (build fails closed without 40 hex digits). */
const headSha = () => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

describe.skipIf(!configured)('the pipeline on the staging worker, against PGlite (D14)', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await freshDb();
    await applyAllMigrations(db);
  }, 180_000);

  it.each(HOSTS)(
    'checks $host ($shape) from request to a persisted, readable check',
    async ({ host, shape }) => {
      const siteId = randomUUID();
      await db.query(`insert into public.sites (id, host) values ($1, $2)`, [siteId, host]);
      const store = sqlPipelineStore(db);
      const sent: CheckRequested[] = [];
      const { checkId } = await requestCheck(
        {
          store,
          send: async (e) => void sent.push(e.data),
          now: Date.now,
          newId: randomUUID,
        },
        { siteId, trigger: 'first_audit' },
      );

      const deps = stepDeps(
        { ...env, VERCEL_GIT_COMMIT_SHA: headSha() },
        { store, evidence: memoryEvidenceStore(), persistDb: pglitePersistDb(db) },
      );

      const steps: { id: string; ms: number }[] = [];
      const slept: { id: string; ms: number }[] = [];
      const emitted: string[] = [];
      const outputs = new Map<string, unknown>();
      const tools: CheckStepTools = {
        run: async (id, fn) => {
          const t = Date.now();
          const out = JSON.parse(JSON.stringify(await fn()));
          steps.push({ id, ms: Date.now() - t });
          outputs.set(id, out);
          return out;
        },
        sleep: async (id, ms) => {
          slept.push({ id, ms });
          await new Promise((r) => setTimeout(r, ms));
        },
        sendEvent: async (id) => void emitted.push(id),
      };

      const t0 = Date.now();
      const result = await runCheck(
        { event: { data: sent[0]! }, step: tools, runId: `live-${checkId}` },
        checkSteps(deps),
      );
      const wallMs = Date.now() - t0;
      const batches = await store.batches(checkId);
      const dataset = await loadCheck(pgliteCheckReader(db), checkId);
      const check = dataset.checks[0]!;
      const fixes = dataset.fixes.map((f) => `${f.type}:${f.last_state}`).sort();
      const discovered = outputs.get('discover') as DiscoverOutput | undefined;
      const reach = {
        pages: dataset.page_results.length,
        link_edges: dataset.link_edges.length,
        sitemap_urls: discovered?.sitemap_urls ?? null,
      };
      const summary = {
        host,
        shape,
        result: result.status,
        check_status: check.status,
        wall_s: Math.round(wallMs / 1000),
        pages: dataset.page_results.length,
        status_codes: Object.fromEntries(
          [...new Set(dataset.page_results.map((p) => p.status_code))]
            .sort()
            .map((s) => [s, dataset.page_results.filter((p) => p.status_code === s).length]),
        ),
        link_edges: dataset.link_edges.length,
        access_tests: dataset.access_tests.length,
        batches: batches.map((b) => ({
          batch: b.batch,
          kind: b.kind,
          status: b.status,
          s:
            b.finished_at === null
              ? null
              : Math.round((Date.parse(b.finished_at) - Date.parse(b.posted_at)) / 1000),
        })),
        step_ms: steps,
        slept_s: Math.round(slept.reduce((n, s) => n + s.ms, 0) / 1000),
        technical_seo: check.technical_seo
          ? { grade: check.technical_seo.grade, score: check.technical_seo.score }
          : null,
        ai_readability: check.ai_readability
          ? {
              withheld: check.ai_readability.withheld,
              withheld_reasons: check.ai_readability.withheld_reasons,
              grade: check.ai_readability.grade,
            }
          : null,
        crawlers: check.crawlers.map((c) => `${c.ua}:${c.verdict}`),
        diff_inputs: await db
          .query<{
            d: { detectors: string[]; indeterminate: string[] } | null;
          }>(`select diff_inputs as d from public.checks where id = $1`, [checkId])
          .then(({ rows: [r] }) =>
            r?.d ? { detectors: r.d.detectors, indeterminate: r.d.indeterminate.length } : null,
          ),
        fixes,
        changes: dataset.changes.length,
        emitted,
        reach,
        // From this run's counts: a run that crawled one page and found no link has no page that
        // could be orphaned or deep, whatever its sitemap listed, so it cannot exercise D8.
        d8:
          reach.pages <= 1 && reach.link_edges === 0
            ? `not exercised: one page crawled, no links (${reach.sitemap_urls ?? 0} sitemap URLs listed)`
            : null,
      };
      console.log(`live ${JSON.stringify(summary)}`);
      if (env.LIVE_OUT) appendFileSync(env.LIVE_OUT, `${JSON.stringify(summary)}\n`);

      expect(result.status).toBe(check.status);
      expect(['finished', 'partial']).toContain(check.status);
      expect(emitted).toEqual(['emit']);
    },
    25 * 60_000,
  );
});
