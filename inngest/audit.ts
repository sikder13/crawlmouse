import type { SupabaseClient } from '@supabase/supabase-js';
import { inngest } from './client';
import { runAudit } from '@crawlmouse/engine';
import { supabaseAdmin } from './supabase';
import { persistAuditResults } from './persist-results';

/**
 * Memory size (MB) advertised to Crawlee. Crawlee's autoscaler measures memory and, UNLESS it
 * detects AWS Lambda via `AWS_LAMBDA_FUNCTION_MEMORY_SIZE`, does so by spawning `ps` — which does
 * NOT exist in the Vercel serverless runtime. That throws `spawn ps ENOENT` inside the crawl step,
 * which then fails and retries forever, leaving every audit stuck `crawling` (proven live: an
 * audit failed with failure_reason "spawn ps ENOENT"). Vercel runs ON AWS Lambda but strips the
 * Lambda-injected `AWS_*` env, so the detection fails. Re-asserting the hint makes Crawlee take its
 * ps-free memory path (`process.memoryUsage()` + `/proc/meminfo`). The value only sizes the
 * autoscaler's memory budget (concurrency is independently capped by `maxConcurrency`), so a
 * generous figure just avoids a false memory-overload throttle; it cannot cause over-scaling.
 */
const CRAWLEE_SERVERLESS_MEMORY_MB = '3008';

/**
 * Apply the Crawlee memory hint when unset. NOT gated on `process.env.VERCEL`: Vercel does not
 * reliably expose `VERCEL` to the FUNCTION RUNTIME (only the build), so an earlier VERCEL-gated
 * version no-opped in prod and the `ps` spawn returned. This module only ever loads in the audit
 * worker — the Vercel serverless function (which needs the hint) or the local `inngest-cli dev`
 * server (Linux, where Crawlee's ps-free path also works) — so applying it whenever unset is safe.
 * Idempotent: never overrides a value the host already set (e.g. real AWS Lambda).
 */
export function ensureServerlessCrawleeMemoryHint(env: Record<string, string | undefined> = process.env): void {
  if (!env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE) {
    env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE = CRAWLEE_SERVERLESS_MEMORY_MB;
  }
}

ensureServerlessCrawleeMemoryHint();

/** The fields carried on an `audit.requested` event (mirrors the client schema). */
export interface AuditEventData {
  auditId: string;
  url: string;
  pageCap?: number;
  perHostConcurrency?: number;
  basicAuth?: { username: string; password: string };
  extraHeaders?: Record<string, string>;
  commitSha?: string;
  environment?: string;
  branch?: string;
  deploymentId?: string;
}

/** The SMALL value that crosses the Inngest step boundary (well under the output limit). */
export interface AuditSummary {
  auditId: string;
  grade: string;
  score: number;
  pages: number;
}

/** Injection seam so the orchestration is unit-testable without a real crawl / DB. */
export interface CrawlAndPersistDeps {
  runAudit: typeof runAudit;
  persistAuditResults: typeof persistAuditResults;
}

const defaultDeps: CrawlAndPersistDeps = { runAudit, persistAuditResults };

/**
 * Per-function concurrency for the audit worker.
 *
 * Inngest validates this at APP SYNC time and REJECTS the entire app registration (no functions
 * get registered, so NO audit ever runs) if a function's concurrency limit exceeds the account
 * plan's cap — the Inngest Free plan caps at 5. Hardcoding the Pro-tier 50 therefore broke prod
 * sync with `"...higher concurrency limits (50) than your plan limit of 5"`. Read the limit from
 * the environment with a plan-safe default so the value tracks the Inngest plan as config, not a
 * code change: leave it unset on Free (-> 5); set INNGEST_AUDIT_CONCURRENCY=50 (the cost-model
 * target, docs/ops/2026-06-03-cost-model.md §4) once the account is on a paid plan whose cap
 * allows it. A missing / non-numeric / non-positive value falls back to the Free-safe 5.
 *
 * Clamped to MAX_AUDIT_CONCURRENCY: a fat-finger env value (e.g. `500`) would otherwise exceed
 * EVERY Inngest plan cap and re-trigger the exact app-sync rejection this change fixes (no
 * functions register → every audit stuck `pending`). Clamping degrades a typo to throttled-but-
 * working instead of a prod outage. NOTE the operator must still keep the value ≤ the account's
 * actual Inngest plan cap; the clamp only bounds gross typos, not plan mismatches.
 */
const MAX_AUDIT_CONCURRENCY = 100; // cost-model docs/ops/2026-06-03-cost-model.md §4 ceiling ("on Pro keep ≤ 100")

export function auditConcurrencyLimit(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.INNGEST_AUDIT_CONCURRENCY);
  if (!Number.isInteger(n) || n <= 0) return 5;
  return Math.min(n, MAX_AUDIT_CONCURRENCY);
}

/**
 * A2 — run the crawl AND persist its result in a SINGLE unit of work, returning only a
 * tiny summary. The multi-MiB crawl result (pages/links/findings) lives solely inside this
 * function's scope: it is handed straight to persistence and never returned. The wrapping
 * `step.run('crawl-and-persist')` therefore serializes only this summary, so the audit can
 * no longer end `failed` with "step output size is greater than the limit" on large sites
 * (the MAJOR launch-deploy finding). Persistence is idempotent (it clears any partial rows
 * first), so a step retry is correct. TRADE-OFF: because crawl + persist are one step, a
 * transient persist failure re-runs the WHOLE crawl on retry (re-fetching up to the page cap),
 * not just the DB write. That cost is accepted here vs. the alternative of streaming the
 * multi-MiB result back across a step boundary; persist failures are rare DB blips.
 */
export async function crawlAndPersist(
  sb: SupabaseClient,
  data: AuditEventData,
  deps: CrawlAndPersistDeps = defaultDeps,
): Promise<AuditSummary> {
  const result = await deps.runAudit({
    url: data.url,
    pageCap: data.pageCap ?? 500,
    perHostConcurrency: data.perHostConcurrency ?? 8,
    staggerMs: 250,
    pageTimeoutMs: 10000,
    basicAuth: data.basicAuth,
    extraHeaders: data.extraHeaders,
    commitSha: data.commitSha,
    environment: data.environment,
    branch: data.branch,
    deploymentId: data.deploymentId,
  });

  await deps.persistAuditResults(sb, data.auditId, result);

  return { auditId: data.auditId, grade: result.grade, score: result.score, pages: result.pages.length };
}

export const auditFn = inngest.createFunction(
  {
    id: 'crawlmouse.audit',
    // Plan-safe: must not exceed the Inngest account's concurrency cap or the whole app sync is
    // rejected and no audits run. Defaults to 5 (Free); raise via INNGEST_AUDIT_CONCURRENCY on Pro.
    concurrency: { limit: auditConcurrencyLimit() },
    // If persistence permanently fails (after retries), don't leave the audit pinned at
    // 'crawling' forever — mark it failed so the result stream resolves.
    onFailure: async ({ event, error }) => {
      const sb = supabaseAdmin();
      const auditId = (event.data as { event?: { data?: { auditId?: string } } }).event?.data?.auditId;
      if (!auditId) return;
      await sb.from('audits').update({
        status: 'failed',
        failure_reason: error instanceof Error ? error.message : 'unknown',
        completed_at: new Date().toISOString(),
      }).eq('id', auditId);
    },
  },
  { event: 'audit.requested' },
  async ({ event, step }) => {
    const sb = supabaseAdmin();
    const { auditId } = event.data;

    await step.run('mark-crawling', async () => {
      await sb.from('audits').update({ status: 'crawling' }).eq('id', auditId);
    });

    // A2: crawl + persist in ONE step so the big crawl result never becomes a step output.
    // Don't mark 'failed' inline: the step auto-retries, so a transient error must not flip
    // the audit to a sticky failed state. onFailure (above) is the single place that marks
    // it failed, after retries are exhausted.
    const summary = await step.run('crawl-and-persist', () => crawlAndPersist(sb, event.data));

    await step.sendEvent('emit-completed', {
      name: 'audit.completed',
      data: { auditId: summary.auditId, grade: summary.grade, score: summary.score },
    });

    return summary;
  },
);
