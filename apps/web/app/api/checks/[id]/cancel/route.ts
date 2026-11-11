import { supabaseServer } from '@/lib/supabase/server';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { checkRouteDeps } from '../_lib/deps';
import { cancel } from './cancel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cancels a queued or running check (CC-22b D9): see cancel.ts. 404 with V2_CHECKS_PUBLIC unset. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!checksPublicEnabled()) return Response.json({ code: 'not_found' }, { status: 404 });
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  const { id } = await params;
  return cancel(id, { userId: user?.id ?? null }, checkRouteDeps(sb));
}
