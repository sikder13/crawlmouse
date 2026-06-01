import { inngest } from './client';
import { runAudit } from '@crawlmouse/engine';
import { supabaseAdmin } from './supabase';
import { persistAuditResults } from './persist-results';

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
    const { auditId, url, pageCap } = event.data;

    await step.run('mark-crawling', async () => {
      await sb.from('audits').update({ status: 'crawling' }).eq('id', auditId);
    });

    // Don't mark 'failed' here: the step auto-retries, so an inline write would flip the
    // audit to a sticky failed state on a transient error that later succeeds. onFailure
    // (above) is the single place that marks it failed, after retries are exhausted.
    const result = await step.run('run-engine', () => runAudit({
      url,
      pageCap: pageCap ?? 500,
      perHostConcurrency: event.data.perHostConcurrency ?? 8,
      staggerMs: 250,
      pageTimeoutMs: 10000,
      basicAuth: event.data.basicAuth,
      extraHeaders: event.data.extraHeaders,
      commitSha: event.data.commitSha,
      environment: event.data.environment,
      branch: event.data.branch,
      deploymentId: event.data.deploymentId,
    }));

    // Idempotent + fail-loud persistence: inserts children then marks the audit completed
    // LAST, clears any partial rows from a prior attempt, and throws on any DB error so a
    // transient failure retries cleanly instead of leaving a half-written "completed" audit.
    await step.run('persist-results', () => persistAuditResults(sb, auditId, result));

    await step.sendEvent('emit-completed', {
      name: 'audit.completed',
      data: { auditId, grade: result.grade, score: result.score },
    });

    return { auditId, grade: result.grade, score: result.score };
  },
);
