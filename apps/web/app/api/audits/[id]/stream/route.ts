import { NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { userIsPro } from '@/lib/pro';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const { data: initial } = await sb.from('audits').select('id, status, grade, score, page_count').eq('id', id).maybeSingle();
      if (initial) send('snapshot', initial);

      const interval = setInterval(async () => {
        const { data } = await sb.from('audits').select('id, status, grade, score, page_count, link_count, cms_detected, user_id').eq('id', id).maybeSingle();
        if (!data) return;
        send('progress', data);
        if (data.status === 'completed' || data.status === 'failed') {
          clearInterval(interval);
          if (data.status === 'completed') {
            const { data: findings } = await sb
              .from('findings')
              .select('category, severity, pages(url)')
              .eq('audit_id', id);
            const { data: { user } } = await sb.auth.getUser();
            const viewerIsPro = user && user.id === data.user_id ? await userIsPro(sb, user.id) : false;
            send('done', { ...data, findings: findings ?? [], viewerIsPro });
          } else {
            send('done', data);
          }
          try { controller.close(); } catch {}
        }
      }, 1000);

      req.signal.addEventListener('abort', () => {
        clearInterval(interval);
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
