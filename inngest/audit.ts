import type { SupabaseClient } from '@supabase/supabase-js';
import { inngest } from './client';
import { runAudit } from '@crawlmouse/engine';
import { supabaseAdmin } from './supabase';
import { persistAuditResults } from './persist-results';

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
    concurrency: { limit: 50 },
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
