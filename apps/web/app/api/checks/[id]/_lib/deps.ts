import 'server-only';
import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { inngest } from '../../../../../../../inngest/client';
import { getClientIp } from '@/lib/client-ip';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseEvidenceStore } from '@/lib/v2/pipeline/evidence';
import { supabaseCheckReader } from '@/lib/v2/pipeline/load';
import type { PublicCheckDeps, Viewer } from '@/lib/v2/pipeline/public';
import { supabasePipelineStore } from '@/lib/v2/pipeline/store';
import { supabaseStreamStore } from '@/lib/v2/pipeline/stream-store';
import { capturePublicEvent } from '../../_lib/events';
import { checkRouteLimits } from './limits';
import type { CancelDeps } from '../cancel/cancel';
import type { NotifyDeps } from '../notify/notify';
import type { StreamDeps } from '../stream/serve';

/**
 * Whether the session's user is a member of a site, asked with the session's own client so the
 * answer is the `sites` row-level policy's for that caller. A user id that is not the session's is
 * refused without a read, and a read that fails throws. It is a second copy of `requestAccess`'s
 * `isMember` (lib/v2/pipeline/public-deps.ts); ../wiring.test.ts compares the two on four cases.
 * It is written here and not imported because that module exports `requestAccess` alone, which
 * reads the session itself, and a public route's own source has to show its `getUser()` call
 * (__tests__/security/route-policy.test.ts).
 */
function sessionMember(session: SupabaseClient, viewer: Viewer): PublicCheckDeps['isMember'] {
  return async (siteId, userId) => {
    if (userId !== viewer.userId) return false;
    const { data: rows, error } = await session.from('sites').select('id').eq('id', siteId);
    if (error) throw new Error(`check routes: reading the site as its member: ${error.code}`);
    return rows.length === 1;
  };
}

/**
 * Production's dependencies for the stream, notify and cancel routes, for the session client and
 * the viewer of the request. Rows are read and written through the service role; membership is
 * asked through the session (`sessionMember`). ../wiring.test.ts runs the three routes into this
 * factory with both Supabase clients recording.
 */
export function checkRouteDeps(
  session: SupabaseClient,
  viewer: Viewer,
): StreamDeps & NotifyDeps & CancelDeps {
  const admin = supabaseAdmin();
  return {
    read: supabaseCheckReader(admin),
    isMember: sessionMember(session, viewer),
    store: { ...supabasePipelineStore(admin), ...supabaseStreamStore(admin) },
    evidence: supabaseEvidenceStore(admin),
    limits: checkRouteLimits,
    captureFinished: captureAfterResponse,
    send: (event) => inngest.send(event),
    clientIp: getClientIp,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

/**
 * `check_finished`, handed to Next's `after` so the stream closes without waiting on PostHog; the
 * capture runs once the response has ended. `after` throws when Next gives it no request scope or
 * no `waitUntil`; the capture is then awaited here, for at most the sender's CAPTURE_TIMEOUT_MS.
 */
const captureAfterResponse: StreamDeps['captureFinished'] = async (req, checkId, properties) => {
  const capture = () => capturePublicEvent(req, 'check_finished', checkId, properties);
  try {
    after(capture);
  } catch {
    await capture();
  }
};
