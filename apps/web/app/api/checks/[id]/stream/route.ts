import { supabaseServer } from '@/lib/supabase/server';
import { checksPublicEnabled } from '@/lib/auth/flags';
import type { Viewer } from '@/lib/v2/pipeline/public';
import { checkRouteDeps } from '../_lib/deps';
import { serveStream } from './serve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// serve.ts closes the stream at STREAM_CLOSE_MS (240 s), inside this.
export const maxDuration = 300;

/** A check's progress as server-sent events (CC-22b D5): see serve.ts. 404 with V2_CHECKS_PUBLIC unset. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!checksPublicEnabled()) return Response.json({ code: 'not_found' }, { status: 404 });
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  const viewer: Viewer = { userId: user?.id ?? null };
  const { id } = await params;
  return serveStream(req, id, viewer, checkRouteDeps(sb, viewer));
}
