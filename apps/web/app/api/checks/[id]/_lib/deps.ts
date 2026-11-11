import 'server-only';
import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { inngest } from '../../../../../../../inngest/client';
import { getClientIp } from '@/lib/client-ip';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseEvidenceStore } from '@/lib/v2/pipeline/evidence';
import { supabaseCheckReader } from '@/lib/v2/pipeline/load';
import { supabasePipelineStore } from '@/lib/v2/pipeline/store';
import { supabaseStreamStore } from '@/lib/v2/pipeline/stream-store';
import { capturePublicEvent } from '../../_lib/events';
import { checkRouteLimits } from './limits';
import type { CancelDeps } from '../cancel/cancel';
import type { NotifyDeps } from '../notify/notify';
import type { StreamDeps } from '../stream/serve';

/**
 * Production's dependencies for the stream, notify and cancel routes. Rows are read and written
 * through the service role; `isMember` asks with the caller's own client, so the answer is the
 * `sites` row-level policy's for that caller.
 */
export function checkRouteDeps(caller: SupabaseClient): StreamDeps & NotifyDeps & CancelDeps {
  const admin = supabaseAdmin();
  return {
    read: supabaseCheckReader(admin),
    async isMember(siteId) {
      const { data } = await caller.from('sites').select('id').eq('id', siteId).maybeSingle();
      return data !== null;
    },
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
