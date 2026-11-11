import { checksPublicEnabled } from '@/lib/auth/flags';
import { requestAccess } from '@/lib/v2/pipeline/public-deps';
import { checkRouteDeps } from '../_lib/deps';
import { cancel } from './cancel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cancels a queued or running check (CC-22b D9): see cancel.ts. 404 with V2_CHECKS_PUBLIC unset. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!checksPublicEnabled()) return Response.json({ code: 'not_found' }, { status: 404 });
  // The session's viewer, and the audit pages' own membership test for that session.
  const { deps: access, viewer } = await requestAccess();
  const { id } = await params;
  return cancel(id, viewer, checkRouteDeps(access.isMember));
}
