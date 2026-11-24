/**
 * Row 23: the daily sentinel's work, which `crawlmouse.sentinel.tick` and `crawlmouse.sentinel.watch`
 * (inngest/sentinel.ts) run in steps.
 *
 * - `due(hour)`: the sites watched this hour: kept, live, unpaused, not staging, on a paid tier now
 *   (`effectiveTier`), whose `sentinelHour` is `hour`. None while the sentinel is hidden
 *   (`featureShown('sentinel')`) or crawling is paused.
 * - `plan(site)`: the latest full check's pages, one per template (`pickPages`).
 * - `look(site, host, pages, n)`: one worker access batch for those pages, under the look's own id
 *   (`lookCheckId`), which no `checks` row holds: the worker keeps batches in memory and reads no
 *   database, and nothing of a look is stored.
 * - `result(site, batch)`: the batch's answer compared with the full check's (`movements`).
 * - `request(site)`: one full check, keyed on the UTC day (`requestCheck`'s `sentinelDay`), within
 *   the day's ceiling on starts. Its diff and the existing alert rules raise the alert.
 */
import { stableId } from '@crawlmouse/engine/v2/pipeline';
import { z } from 'zod';
import { effectiveTier } from '../../entitlement-v2';
import type { WorkerClient } from '../../worker-client/types';
import { clockFromAccountRow } from '../pipeline/load-for';
import { movements, pickPages, sentinelHour, type Look, type TestedPage } from './sentinel';

/** A look's budget: a few pages as seven identities, well inside an access batch's. */
export const SENTINEL_LOOK_BUDGET = {
  max_requests: 120,
  max_bytes: 16 * 1024 * 1024,
  max_seconds: 120,
} as const;

/** Sites read per page of `watchableSites`. */
export const SENTINEL_PAGE = 200;

export interface WatchableSite {
  siteId: string;
  host: string;
  /** The account's row, as `clockFromAccountRow` reads it. */
  account: Record<string, unknown>;
}

export type BaselineTest = TestedPage & Look;

export interface SentinelStore {
  /** Kept, live, unpaused, non-staging sites in id order from `offset`, `SENTINEL_PAGE` at most. */
  watchableSites(offset: number): Promise<WatchableSite[]>;
  /** The site's latest finished or partial check, its host and its access tests; null for none. */
  baseline(
    siteId: string,
  ): Promise<{ checkId: string; host: string; tests: BaselineTest[] } | null>;
}

export interface SentinelDeps {
  store: SentinelStore;
  shown(): boolean;
  paused(): boolean;
  now(): number;
  /** Null when no worker is configured. */
  worker(): WorkerClient | null;
  nonce(): string;
  /** The day's ceiling on check starts; false when reached or not counted. */
  global(): Promise<boolean>;
  /** `requestCheck` with trigger `scheduled` and `sentinelDay`; answers the check id. */
  request(siteId: string, day: string): Promise<string>;
}

export type Page = { template_key: string; url: string };

/** The id a look's batch is posted under: one per site, day and attempt. */
export const lookCheckId = (siteId: string, day: string, n: number): string =>
  stableId('sentinel_look', siteId, day, String(n));

const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** What a look's answer is read for; the rest of the worker's result is not kept. */
const LookResultSchema = z.object({
  kind: z.literal('access'),
  access_tests: z.array(
    z.object({
      ua: z.string().nullable(),
      template_key: z.string(),
      verdict: z.enum([
        'allowed',
        'allowed_thin',
        'disallowed_by_robots',
        'blocked_by_ua_rule',
        'challenged_ua',
        'refused_unverified',
        'rate_limited',
        'payment_required',
        'edge_blocks_automation',
        'redirected_away',
        'not_measured',
      ]),
      word_count: z.number().int().min(0).nullable(),
    }),
  ),
});

export function sentinelWork(deps: SentinelDeps) {
  return {
    async due(hour: number): Promise<{ skip: string } | { siteIds: string[] }> {
      if (!deps.shown()) return { skip: 'hidden' };
      if (deps.paused()) return { skip: 'crawl_paused' };
      const now = new Date(deps.now());
      const siteIds: string[] = [];
      for (let offset = 0; ; offset += SENTINEL_PAGE) {
        const page = await deps.store.watchableSites(offset);
        for (const s of page) {
          if (sentinelHour(s.siteId) !== hour) continue;
          if (effectiveTier(clockFromAccountRow(s.account), now) === 'free') continue;
          siteIds.push(s.siteId);
        }
        if (page.length < SENTINEL_PAGE) break;
      }
      return { siteIds };
    },

    async plan(
      siteId: string,
    ): Promise<{ skip: string } | { host: string; baseline: string; pages: Page[] }> {
      const base = await deps.store.baseline(siteId);
      if (base === null) return { skip: 'no_baseline' };
      const pages = pickPages(base.tests);
      if (pages.length === 0) return { skip: 'no_pages' };
      return { host: base.host, baseline: base.checkId, pages };
    },

    async look(
      siteId: string,
      host: string,
      pages: Page[],
      n: number,
    ): Promise<{ skip: string } | { batchId: string }> {
      const worker = deps.worker();
      if (worker === null) return { skip: 'no_worker' };
      const posted = await worker.postBatch({
        kind: 'access',
        check_id: lookCheckId(siteId, dayOf(deps.now()), n),
        site_id: siteId,
        site_host: host,
        batch: 0,
        nonce: deps.nonce(),
        budget: SENTINEL_LOOK_BUDGET,
        pages,
      });
      return { batchId: posted.batch_id };
    },

    async result(
      siteId: string,
      batchId: string,
    ): Promise<{ status: 'running' | 'failed' } | { status: 'done'; moved: number }> {
      const worker = deps.worker();
      if (worker === null) return { status: 'failed' };
      const poll = await worker.pollBatch(batchId);
      if (poll.status === 'running') return { status: 'running' };
      if (poll.status !== 'done') return { status: 'failed' };
      const parsed = LookResultSchema.safeParse(poll.result);
      if (!parsed.success) return { status: 'failed' };
      const base = await deps.store.baseline(siteId);
      if (base === null) return { status: 'failed' };
      return { status: 'done', moved: movements(base.tests, parsed.data.access_tests).length };
    },

    async request(siteId: string): Promise<{ skip: string } | { checkId: string }> {
      if (deps.paused()) return { skip: 'crawl_paused' };
      if (!(await deps.global())) return { skip: 'capacity' };
      return { checkId: await deps.request(siteId, dayOf(deps.now())) };
    },
  };
}

export type SentinelWork = ReturnType<typeof sentinelWork>;
