/**
 * D14, the live run: a check of a real site through the deployed staging worker, with the pipeline's
 * own steps and orchestration (`runCheck` over `checkSteps`), wired as production wires them
 * (functions.ts `stepDeps`) except for two stores: PGlite with every migration instead of the
 * production database, and an in-memory bucket instead of Storage. Nothing here reads or writes
 * production data.
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
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { capsFromEnv, clientFromEnv, safeFetch } from '@crawlmouse/engine/v2/pipeline';
import { beforeAll, describe, expect, it } from 'vitest';
import { runCheck, type CheckStepTools } from '../../../../../inngest/check';
import type { CheckRequested } from '../../../../../inngest/check-events';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { workerClientFromEnv } from '../../worker-client/client';
import { CRAWL_USER_AGENT } from './discover';
import { loadCheck } from './load';
import { requestCheck } from './request';
import { NO_DAILY_BUDGET, checkSteps, type StepDeps } from './steps';
import { memoryEvidenceStore } from './test-support/memory-evidence';
import { pgliteCheckReader, pglitePersistDb } from './test-support/pglite';
import { sqlPipelineStore } from './test-support/sql-store';

const env = process.env;
const configured = ['CRAWL_WORKER_URL', 'WORKER_SIGNING_SECRET', 'WORKER_JWT_PRIVATE_KEY_PKCS8_B64']
  .map((k) => env[k])
  .every((v) => typeof v === 'string' && v.length > 0);

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

      const deps: StepDeps = {
        store,
        evidence: memoryEvidenceStore(),
        persistDb: pglitePersistDb(db),
        worker: workerClientFromEnv(env),
        now: Date.now,
        nonce: () => randomBytes(24).toString('base64url'),
        env: { VERCEL_GIT_COMMIT_SHA: headSha() },
        render: {
          client: clientFromEnv(env),
          caps: capsFromEnv(env),
          daily: NO_DAILY_BUDGET,
          inFlight: 2,
        },
        discover: { fetch: safeFetch, userAgent: CRAWL_USER_AGENT, now: Date.now },
      };

      const steps: { id: string; ms: number }[] = [];
      const slept: { id: string; ms: number }[] = [];
      const emitted: string[] = [];
      const tools: CheckStepTools = {
        run: async (id, fn) => {
          const t = Date.now();
          const out = JSON.parse(JSON.stringify(await fn()));
          steps.push({ id, ms: Date.now() - t });
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
      };
      console.log(`live ${JSON.stringify(summary)}`);
      if (env.LIVE_OUT) appendFileSync(env.LIVE_OUT, `${JSON.stringify(summary)}\n`);

      expect(['finished', 'partial']).toContain(check.status);
      expect(emitted).toEqual(['emit']);
      if (host === 'www.alynthe.com') {
        // D8: a site served for JavaScript to fill in has no orphan or deep-page finding detected.
        expect(fixes.filter((f) => /^(orphan_pages|deep_pages):detected$/.test(f))).toEqual([]);
      }
    },
    25 * 60_000,
  );
});
