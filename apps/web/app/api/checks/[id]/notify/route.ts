import { checksPublicEnabled } from '@/lib/auth/flags';
import { requestAccess } from '@/lib/v2/pipeline/public-deps';
import { checkRouteDeps } from '../_lib/deps';
import { notify } from './notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Stores where to send a check's result (CC-22b D9): see notify.ts. 404 with V2_CHECKS_PUBLIC unset. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!checksPublicEnabled()) return Response.json({ code: 'not_found' }, { status: 404 });
  // The session's viewer, and the audit pages' own membership test for that session.
  const { deps: access, viewer } = await requestAccess();
  const { id } = await params;
  const body: unknown = await req.json().catch(() => null);
  return notify(req, body, id, viewer, checkRouteDeps(access.isMember));
}
