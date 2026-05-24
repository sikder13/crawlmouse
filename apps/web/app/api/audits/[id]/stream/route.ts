import { NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

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
        const { data } = await sb.from('audits').select('id, status, grade, score, page_count, link_count, cms_detected').eq('id', id).maybeSingle();
        if (!data) return;
        send('progress', data);
        if (data.status === 'completed' || data.status === 'failed') {
          clearInterval(interval);
          send('done', data);
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
