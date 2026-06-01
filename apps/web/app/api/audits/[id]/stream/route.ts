import { NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { userIsPro } from '@/lib/pro';
import { groupAndCapFindings, type FindingRow } from '@/lib/findings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AUDIT_COLS = 'id, status, grade, score, page_count, link_count, cms_detected, user_id, settings';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();

  // Completion payload: cap findings SERVER-SIDE so a non-Pro client never receives the gated rows.
  async function buildDone(data: Record<string, unknown>) {
    if (data.status !== 'completed') return data;
    const { data: findings } = await sb.from('findings').select('category, severity, pages(url)').eq('audit_id', id);
    const { data: { user } } = await sb.auth.getUser();
    const viewerIsPro = user && user.id === data.user_id ? await userIsPro(sb, user.id) : false;
    const findingGroups = groupAndCapFindings((findings ?? []) as unknown as FindingRow[], viewerIsPro);
    return { ...data, findingGroups, viewerIsPro };
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

      const { data: initial } = await sb.from('audits').select(AUDIT_COLS).eq('id', id).maybeSingle();
      if (initial) send('snapshot', initial);

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
          const { data } = await sb.from('audits').select(AUDIT_COLS).eq('id', id).maybeSingle();
          if (!data || closed) return;
          send('progress', data);
          if (data.status === 'completed' || data.status === 'failed') {
            clearInterval(interval);
            send('done', await buildDone(data));
            finish();
          }
        } finally {
          inFlight = false;
        }
      }, 2000);

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
