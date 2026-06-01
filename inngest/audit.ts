import { inngest } from './client';
import { runAudit } from '@crawlmouse/engine';
import { supabaseAdmin } from './supabase';
import { buildPageRows, buildLinkRows, buildFindingRows } from './persist-helpers';

/** PostgREST caps a query (and an insert's RETURNING) at ~1000 rows by default. */
const PAGE_READBACK = 1000;

export const auditFn = inngest.createFunction(
  { id: 'crawlmouse.audit', concurrency: { limit: 50 } },
  { event: 'audit.requested' },
  async ({ event, step }) => {
    const sb = supabaseAdmin();
    const { auditId, url, pageCap } = event.data;

    await step.run('mark-crawling', async () => {
      await sb.from('audits').update({ status: 'crawling' }).eq('id', auditId);
    });

    const result = await step.run('run-engine', async () => {
      try {
        return await runAudit({
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
        });
      } catch (e) {
        const reason = e instanceof Error ? e.message : 'unknown';
        await sb.from('audits').update({ status: 'failed', failure_reason: reason, completed_at: new Date().toISOString() }).eq('id', auditId);
        throw e;
      }
    });

    await step.run('persist-results', async () => {
      // Insert all children first, then flip status to 'completed' LAST. The SSE stream
      // treats 'completed' as "done" and reads findings; if the status flipped before the
      // findings existed, a poll landing in that gap would emit done with zero findings and
      // the client would close the stream permanently showing no findings.
      await sb.from('pages').insert(buildPageRows(auditId, result.pages));

      // Build url -> page id from a paged read-back, NOT the insert's RETURNING: PostgREST
      // caps the returned rows at ~1000, which silently dropped links/findings for crawls
      // over the cap (2,000-page Pro audits).
      const urlToPageId = new Map<string, string>();
      for (let from = 0; ; from += PAGE_READBACK) {
        const { data } = await sb.from('pages').select('id, url').eq('audit_id', auditId).range(from, from + PAGE_READBACK - 1);
        if (!data || data.length === 0) break;
        for (const p of data as { id: string; url: string }[]) urlToPageId.set(p.url, p.id);
        if (data.length < PAGE_READBACK) break;
      }

      const linkRows = buildLinkRows(auditId, result.links, urlToPageId);
      if (linkRows.length > 0) await sb.from('links').insert(linkRows);

      const findingRows = buildFindingRows(auditId, result.findings, urlToPageId);
      if (findingRows.length > 0) await sb.from('findings').insert(findingRows);

      await sb.from('audits').update({
        status: 'completed',
        cms_detected: result.cms,
        cms_metadata: result.cmsMetadata,
        page_count: result.pages.length,
        link_count: result.links.length,
        score: result.score,
        grade: result.grade,
        completed_at: new Date(result.completedAt as unknown as string).toISOString(),
      }).eq('id', auditId);
    });

    await step.sendEvent('emit-completed', {
      name: 'audit.completed',
      data: { auditId, grade: result.grade, score: result.score },
    });

    return { auditId, grade: result.grade, score: result.score };
  },
);
