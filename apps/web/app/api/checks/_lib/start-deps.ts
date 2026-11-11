/** What a public start runs on in production: the service-role client, the limiter and Inngest. */
import 'server-only';
import { admitSiteHost } from '../../../../lib/auth/admit-site';
import { inngest } from '../../../../lib/inngest';
import { supabaseAdmin } from '../../../../lib/supabase/admin';
import { verifyTurnstileToken } from '../../../../lib/turnstile';
import { supabasePipelineStore } from '../../../../lib/v2/pipeline/store';
import type { StartDeps } from './start';
import { startLimits } from './start-limits';
import { supabaseStartStore } from './start-store';

export function startDeps(signedIn: StartDeps['signedIn']): StartDeps {
  const sb = supabaseAdmin();
  return {
    admit: (host) => admitSiteHost(host),
    store: supabaseStartStore(sb),
    limits: startLimits,
    signedIn,
    verifyTurnstile: verifyTurnstileToken,
    pipeline: {
      store: supabasePipelineStore(sb),
      send: (event) => inngest.send(event),
      now: Date.now,
    },
  };
}
