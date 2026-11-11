import 'server-only';
import { after } from 'next/server';
import { inngest } from '../../../../../../../inngest/client';
import { getClientIp } from '@/lib/client-ip';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseEvidenceStore } from '@/lib/v2/pipeline/evidence';
import { supabaseCheckReader } from '@/lib/v2/pipeline/load';
import type { PublicCheckDeps } from '@/lib/v2/pipeline/public';
import { supabasePipelineStore } from '@/lib/v2/pipeline/store';
import { supabaseStreamStore } from '@/lib/v2/pipeline/stream-store';
import { capturePublicEvent } from '../../_lib/events';
import { checkRouteLimits } from './limits';
import type { CancelDeps } from '../cancel/cancel';
import type { NotifyDeps } from '../notify/notify';
import type { StreamDeps } from '../stream/serve';

/**
 * Production's dependencies for the stream, notify and cancel routes. Rows are read and written
 * through the service role. `isMember` is handed in: the routes pass the one the audit pages use
 * (`requestAccess`, lib/v2/pipeline/public-deps.ts), which asks with the caller's own session, so
 * the answer is the `sites` row-level policy's for that caller. wiring.test.ts runs the three
 * routes into this factory with both Supabase clients recording.
 */
export function checkRouteDeps(
  isMember: PublicCheckDeps['isMember'],
): StreamDeps & NotifyDeps & CancelDeps {
  const admin = supabaseAdmin();
  return {
    read: supabaseCheckReader(admin),
    isMember,
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
