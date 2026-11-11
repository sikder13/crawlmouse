import { supabaseServer } from '@/lib/supabase/server';
import { checksPublicEnabled } from '@/lib/auth/flags';
import type { Viewer } from '@/lib/v2/pipeline/public';
import { checkRouteDeps } from '../_lib/deps';
import { notify } from './notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Stores where to send a check's result (CC-22b D9): see notify.ts. 404 with V2_CHECKS_PUBLIC unset. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!checksPublicEnabled()) return Response.json({ code: 'not_found' }, { status: 404 });
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  const viewer: Viewer = { userId: user?.id ?? null };
  const { id } = await params;
  const body: unknown = await req.json().catch(() => null);
  return notify(req, body, id, viewer, checkRouteDeps(sb, viewer));
}
