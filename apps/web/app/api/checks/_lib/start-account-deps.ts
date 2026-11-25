/**
 * What a signed-in start runs on in production: the public start's guard, limiter and Turnstile, the
 * caller's own client for the reads, and the service role for `add_site` and `request_capped_check`
 * (the writes `/api/sites` and the site's re-check route make).
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { admitSiteHost } from '../../../../lib/auth/admit-site';
import { scheduleFor } from '../../../../lib/auth/schedule';
import { supabaseAdmin } from '../../../../lib/supabase/admin';
import { accountPageCap } from '../../../../lib/v2/pipeline/page-cap';
import { verifyTurnstileToken } from '../../../../lib/turnstile';
import {
  supabaseAddSite,
  supabaseRequestRecheck,
  supabaseResendQueued,
} from '../../../../lib/v2/account/sites-store';
import type { AccountStartDeps } from './start-account';
import { sessionAccountStartStore } from './start-account-store';
import { startLimits } from './start-limits';

export function accountStartDeps(session: SupabaseClient): AccountStartDeps {
  const admin = supabaseAdmin();
  return {
    admit: (host) => admitSiteHost(host),
    limits: startLimits,
    verifyTurnstile: verifyTurnstileToken,
    ...sessionAccountStartStore(session),
    schedule: scheduleFor,
    addSite: supabaseAddSite(admin),
    recheck: supabaseRequestRecheck(admin),
    resendQueued: supabaseResendQueued((accountId) => accountPageCap(admin, accountId)),
    now: () => new Date(),
  };
}
