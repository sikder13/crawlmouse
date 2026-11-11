import { checksPublicEnabled } from '@/lib/auth/flags';
import { requestAccess } from '@/lib/v2/pipeline/public-deps';
import { checkRouteDeps } from '../_lib/deps';
import { serveStream } from './serve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// serve.ts closes the stream at STREAM_CLOSE_MS (240 s), inside this.
export const maxDuration = 300;

/** A check's progress as server-sent events (CC-22b D5): see serve.ts. 404 with V2_CHECKS_PUBLIC unset. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!checksPublicEnabled()) return Response.json({ code: 'not_found' }, { status: 404 });
  // The session's viewer, and the audit pages' own membership test for that session.
  const { deps: access, viewer } = await requestAccess();
  const { id } = await params;
  return serveStream(req, id, viewer, checkRouteDeps(access.isMember));
}
