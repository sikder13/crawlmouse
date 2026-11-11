/**
 * The live run of the public check flow (CC-22b): a visitor's start, the pipeline on the deployed
 * staging worker, the progress stream, the read-back and the rendered result page, in one process.
 *
 * What is the product's own code: `startPublicCheck` with the real SSRF guard and real DNS; the
 * pipeline's steps and orchestration (`runCheck` over `checkSteps`, as CC-20b's live run); the
 * stream (`serveStream`), opened while the check runs and again after it ends; `loadCheckFor`; and
 * the result page's component. What differs from production:
 *
 * - the database is PGlite with every migration, through the SQL twins of the stores, where
 *   production runs the supabase-js stores over PostgREST;
 * - the evidence store is a bucket in memory, where production uses Storage;
 * - the start's limits, Turnstile and session answer "allowed, no session" (each has its own
 *   tests); the stream's limits are the harness's counters;
 * - each pipeline step runs once, with no retries and no replays, and each sleep is a real wait;
 * - the page is rendered to markup here, not served by Next.
 *
 * Nothing here reads or writes production data.
 *
 * Skipped unless the three worker values are in the environment (the gitignored scripts/.env.local):
 *
 *   set -a; . scripts/.env.local; set +a
 *   LIVE_OUT=<file> pnpm --filter @crawlmouse/web exec vitest run app/api/checks/live.test.tsx
 *
 * The summary line holds counts, step ids and the site's own host: no credential, no check id.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { runCheck, type CheckStepTools } from '../../../../../inngest/check';
import type { CheckRequested } from '../../../../../inngest/check-events';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { groupsOf, harness, request } from '../../../__tests__/v2/_lib/check-routes-harness';
import { admitSiteHost } from '../../../lib/auth/admit-site';
import { stepDeps } from '../../../lib/v2/pipeline/functions';
import { loadCheckFor } from '../../../lib/v2/pipeline/load-for';
import { checkSteps } from '../../../lib/v2/pipeline/steps';
import { pglitePersistDb } from '../../../lib/v2/pipeline/test-support/pglite';
import { memberUnderRls, planFromDb } from '../../../lib/v2/pipeline/test-support/public-checks';
import { sqlPipelineStore } from '../../../lib/v2/pipeline/test-support/sql-store';
import {
  INITIAL_STATE,
  reduce,
  type CrawlState,
  type ProgressEvent,
} from '../../../lib/v2/progress';
import { CheckPage } from '../../audit/[id]/_lib/CheckPage';
import { startPublicCheck } from './_lib/start';
import { sqlStartStore } from './_lib/start-store-sql';
import { serveStream } from './[id]/stream/serve';

vi.mock('server-only', () => ({}));

const env = process.env;
const configured = ['CRAWL_WORKER_URL', 'WORKER_SIGNING_SECRET', 'WORKER_JWT_PRIVATE_KEY_PKCS8_B64']
  .map((k) => env[k])
  .every((v) => typeof v === 'string' && v.length > 0);

const HOST = 'books.toscrape.com';
const anonymous = { userId: null };
const headSha = () => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const fold = (events: readonly ProgressEvent[], from: CrawlState = INITIAL_STATE) =>
  events.reduce(reduce, from);

describe.skipIf(!configured)('the public check flow on the staging worker, against PGlite', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await freshDb();
    await applyAllMigrations(db);
  }, 180_000);

  it(
    `a visitor checks ${HOST}: start, run, stream, read-back, result page`,
    async () => {
      const h = harness(db);
      const store = sqlPipelineStore(db);
      const sent: CheckRequested[] = [];

      // 1. The start, as POST /api/checks runs it after its flag and body checks.
      const start = () =>
        startPublicCheck(
          {
            admit: (host) => admitSiteHost(host),
            store: sqlStartStore(db),
            limits: {
              global: async () => true,
              ip: async () => ({ allowed: true, resetAt: new Date() }),
              domain: async () => true,
              replay: async () => true,
            },
            signedIn: async () => false,
            verifyTurnstile: async () => false,
            pipeline: { store, send: async (e) => void sent.push(e.data), now: Date.now },
          },
          { url: `https://${HOST}/`, requestId, ip: '203.0.113.7' },
        );
      const requestId = randomUUID();
      const started = await start();
      if (!started.ok) throw new Error(`the start was refused: ${started.body.code}`);
      const checkId = started.checkId;
      // The same request again names the same check and makes no second row.
      expect(await start()).toMatchObject({ ok: true, checkId, created: false });
      const { rows: made } = await db.query<{ n: number }>(
        `select count(*)::int as n from public.checks`,
      );
      expect(made[0]!.n).toBe(1);

      // 2. The pipeline, on the staging worker, writing to the stream harness's evidence bucket.
      const deps = stepDeps(
        { ...env, VERCEL_GIT_COMMIT_SHA: headSha() },
        { store, evidence: h.memory, persistDb: pglitePersistDb(db) },
      );
      const steps: string[] = [];
      const tools: CheckStepTools = {
        run: async (id, fn) => {
          steps.push(id);
          return JSON.parse(JSON.stringify(await fn()));
        },
        sleep: async (_id, ms) => {
          await new Promise((r) => setTimeout(r, ms));
        },
        sendEvent: async () => undefined,
      };
      const t0 = Date.now();
      const run = runCheck(
        { event: { data: sent[0]! }, step: tools, runId: `live-${randomUUID()}` },
        checkSteps(deps),
      );

      // 3. The stream while the check runs: one connection, read to its close, with real time.
      h.deps.now = Date.now;
      h.deps.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const open = (lastId?: string) =>
        serveStream(
          request(`/api/checks/${checkId}/stream`, {
            headers: lastId === undefined ? {} : { 'last-event-id': lastId },
          }),
          checkId,
          anonymous,
          h.deps,
        );
      let live: CrawlState = INITIAL_STATE;
      let cursor: string | undefined;
      let connections = 0;
      while (live.ended === null) {
        const res = await open(cursor);
        expect(res.status).toBe(200);
        connections += 1;
        const { groups } = groupsOf(await res.text());
        // No cursor means the stream starts again from the check's beginning.
        if (cursor === undefined) live = INITIAL_STATE;
        live = fold(
          groups.flatMap((g) => g.events),
          live,
        );
        cursor = groups.at(-1)?.id ?? cursor;
        if (connections > 40) throw new Error('the stream did not end in 40 connections');
      }
      const result = await run;
      const wallS = Math.round((Date.now() - t0) / 1000);

      // 4. The stream opened afresh after the end: the same map, from the stored batches.
      const replay = fold(groupsOf(await (await open()).text()).groups.flatMap((g) => g.events));
      expect(replay.ended).toBe(live.ended);
      expect(replay.nodes.map((n) => n.url).sort()).toEqual(live.nodes.map((n) => n.url).sort());

      // 5. The read-back a page makes, as a visitor with the id.
      const read = await loadCheckFor(
        {
          read: h.deps.read,
          evidence: h.memory,
          isMember: memberUnderRls(db),
          planOf: planFromDb(db, Date.now),
          now: Date.now,
        },
        checkId,
        anonymous,
      );
      if (read?.state !== 'ready') throw new Error(`the check read back as ${read?.state}`);
      const check = read.dataset.checks.find((c) => c.id === checkId)!;

      // 6. The result page's markup.
      const markup = renderToStaticMarkup(<CheckPage read={read} />);

      const summary = {
        host: HOST,
        result: result.status,
        check_status: check.status,
        wall_s: wallS,
        steps: steps.length,
        pages: read.dataset.page_results.length,
        link_edges: read.dataset.link_edges.length,
        fixes: read.dataset.fixes.length,
        plan: read.plan,
        map_stored: read.map !== null,
        expires_in_h: check.expires_at
          ? Math.round((Date.parse(check.expires_at) - Date.parse(check.queued_at)) / 3_600_000)
          : null,
        stream: {
          connections,
          ended: live.ended,
          pages_crawled: live.pages_crawled,
          links_found: live.links_found,
          nodes_drawn: live.nodes.length,
        },
        page_bytes: markup.length,
      };
      console.log(`live ${JSON.stringify(summary)}`);
      if (env.LIVE_OUT) appendFileSync(env.LIVE_OUT, `${JSON.stringify(summary)}\n`);

      expect(['finished', 'partial']).toContain(check.status);
      expect(result.status).toBe(check.status);
      expect(live.ended).toBe(check.status);
      expect(summary.expires_in_h).toBe(24);
      expect(read.plan).toBe('free');
      // The stream counted pages, and its map holds only pages the check's record has.
      expect(live.pages_crawled).toBeGreaterThan(0);
      expect(live.nodes.length).toBeGreaterThan(0);
      const crawled = new Set(read.dataset.page_results.map((p) => p.url));
      expect(live.nodes.filter((n) => !crawled.has(n.url))).toEqual([]);
      // The page names the site and carries no id of the check's rows other than in its own links.
      expect(markup).toContain(HOST);
      expect(markup).not.toContain(read.dataset.sites[0]!.id);
    },
    30 * 60_000,
  );
});
