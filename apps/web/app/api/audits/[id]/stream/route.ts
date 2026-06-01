import { NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { userIsPro } from '@/lib/pro';
import { groupAndCapFindings, type FindingRow } from '@/lib/findings';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { aggregateGraphStats, type GraphStatPage } from '@/lib/audit-stats';
import { asNumber } from '@/lib/numeric';
import { SSE_POLL_MS, SSE_MAX_DURATION_S } from '@/lib/limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Hold the stream open for the crawl instead of being killed mid-poll and churning
// EventSource reconnects. Vercel Fluid Compute allows up to 300s (Hobby) / 800s (Pro).
export const maxDuration = SSE_MAX_DURATION_S;

// Capability-URL model: the audit is read by its unguessable UUID via the service-role
// client (so an anonymous owner — user_id = null — can see their own result), exactly
// like a public report slug. user_id is read for the owner/Pro gate but NEVER sent to
// the client; settings carries only the page cap.
const AUDIT_COLS = 'id, status, grade, score, page_count, link_count, cms_detected, user_id, settings';

interface AuditRow {
  id: string;
  status: string;
  grade: string | null;
  score: number | string | null;
  page_count: number | null;
  link_count: number | null;
  cms_detected: string | null;
  user_id: string | null;
  settings: { pageCap?: number } | null;
}

/** Client-safe projection: drop user_id, coerce the numeric score string to a number. */
function projectForClient(row: AuditRow) {
  return {
    id: row.id,
    status: row.status,
    grade: row.grade,
    score: asNumber(row.score),
    page_count: row.page_count,
    link_count: row.link_count,
    cms_detected: row.cms_detected,
    settings: row.settings,
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = supabaseAdmin();
  const sbAuth = await supabaseServer();

  // Completion payload: cap findings SERVER-SIDE so a non-Pro client never receives the
  // gated rows, and compute the headline graph stats. Reads go through the service-role
  // client so anonymous audits resolve; findings are paged so big Pro audits aren't
  // truncated at PostgREST's ~1000-row cap.
  async function buildDone(row: AuditRow) {
    if (row.status !== 'completed') return projectForClient(row);
    const findings = await fetchAll<FindingRow>(admin, 'findings', 'category, severity, pages(url)', id);
    const pages = await fetchAll<GraphStatPage>(admin, 'pages', 'is_orphan, depth', id);
    const { data: { user } } = await sbAuth.auth.getUser();
    const viewerIsPro = user && user.id === row.user_id ? await userIsPro(sbAuth, user.id) : false;
    const findingGroups = groupAndCapFindings(findings, viewerIsPro);
    const { orphanCount, avgDepth } = aggregateGraphStats(pages);
    return { ...projectForClient(row), findingGroups, viewerIsPro, orphanCount, avgDepth };
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let inFlight = false;
      const send = (event: string, payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const finish = () => {
        closed = true;
        try { controller.close(); } catch {}
      };

      const { data: initial } = await admin.from('audits').select(AUDIT_COLS).eq('id', id).maybeSingle<AuditRow>();
      if (initial) send('snapshot', projectForClient(initial));

      // Short-circuit: audit already finished at load → emit done immediately, never start polling.
      if (initial && (initial.status === 'completed' || initial.status === 'failed')) {
        send('done', await buildDone(initial));
        finish();
        return;
      }

      const interval = setInterval(async () => {
        if (inFlight || closed) return; // guard against overlapping ticks (a slow tick + the next)
        inFlight = true;
        try {
          const { data } = await admin.from('audits').select(AUDIT_COLS).eq('id', id).maybeSingle<AuditRow>();
          if (!data || closed) return;
          send('progress', projectForClient(data));
          if (data.status === 'completed' || data.status === 'failed') {
            clearInterval(interval);
            send('done', await buildDone(data));
            finish();
          }
        } finally {
          inFlight = false;
        }
      }, SSE_POLL_MS);

      req.signal.addEventListener('abort', () => {
        clearInterval(interval);
        finish();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
