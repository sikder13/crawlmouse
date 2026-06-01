import { inngest } from './client';
import { runAudit } from '@crawlmouse/engine';
import { supabaseAdmin } from './supabase';

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

      const pageRows = result.pages.map((p) => ({
        audit_id: auditId,
        url: p.url,
        url_hash: p.urlHash,
        title: p.title,
        status_code: p.statusCode,
        depth: p.depth,
        in_degree: p.inDegree,
        out_degree: p.outDegree,
        is_orphan: p.isOrphan,
      }));
      const { data: insertedPages } = await sb.from('pages').insert(pageRows).select('id, url');
      const urlToPageId = new Map<string, string>((insertedPages ?? []).map((p: { id: string; url: string }) => [p.url, p.id]));

      const linkRows = result.links
        .map((l) => ({
          audit_id: auditId,
          from_page_id: urlToPageId.get(l.fromUrl),
          to_page_id: urlToPageId.get(l.toUrl),
          anchor_text: l.anchorText,
          is_generic_anchor: l.isGenericAnchor,
        }))
        .filter((r) => r.from_page_id && r.to_page_id);
      if (linkRows.length > 0) await sb.from('links').insert(linkRows);

      const findingRows = result.findings.map((f) => ({
        audit_id: auditId,
        category: f.category,
        severity: f.severity,
        page_id: f.pageUrl ? urlToPageId.get(f.pageUrl) ?? null : null,
        payload: f.payload ?? null,
      }));
      if (findingRows.length > 0) await sb.from('findings').insert(findingRows);
    });

    await step.sendEvent('emit-completed', {
      name: 'audit.completed',
      data: { auditId, grade: result.grade, score: result.score },
    });

    return { auditId, grade: result.grade, score: result.score };
  },
);
