import 'server-only';
import * as Sentry from '@sentry/nextjs';
import { startLimits } from '../../app/api/checks/_lib/start-limits';
import { supabaseAdmin } from '../supabase/admin';
import { supabaseEntitlementStore } from '../billing/state-machine-apply';
import { billingDispatcher } from '../billing/effect-sinks';
import { isCrawlPaused } from '../crawl-pause';
import { inngest } from '../inngest';
import { supabaseEvidenceStore } from '../v2/pipeline/evidence';
import { firstAuditRequester } from '../v2/pipeline/first-audit';
import { claimKeep } from '../v2/pipeline/keep';
import { supabaseKeepStore } from '../v2/pipeline/keep-store';
import { supabasePipelineStore } from '../v2/pipeline/store';
import type { ClaimDeps } from './claim';
import type { FirstLoginDeps } from './first-login';
import { checksPublicEnabled, pipelineEnabled } from './flags';
import { pepperFrom } from './ledger';
import { admitSiteHost } from './admit-site';
import { sentryReport, supabaseDoorStore } from './stores';

/**
 * The door's production dependencies: the service-role client and Sentry.
 *
 * With V2_CHECKS_PUBLIC=1 (CC-22b D7) the claim gets `keep`: its commit becomes `keep_check` and the
 * claimed check's evidence moves to the account. With V2_PIPELINE=1 as well, the claim and the
 * first-login hook get `firstAudit`; without the pipeline's functions nothing runs a requested check,
 * so none is requested. With V2_CHECKS_PUBLIC unset neither is given, and both do what they did
 * before CC-22b
 * (`pnpm --filter @crawlmouse/web exec vitest run lib/auth/door-deps.test.ts`).
 */
export function doorDeps(): { firstLogin: FirstLoginDeps; claim: ClaimDeps } {
  const sb = supabaseAdmin();
  const store = supabaseDoorStore(sb);
  const now = () => new Date();
  const report = sentryReport((m, ctx) => Sentry.captureMessage(m, ctx));
  const publicChecks = checksPublicEnabled();
  const keepStore = supabaseKeepStore(sb);
  const keep = publicChecks
    ? claimKeep({ store: keepStore, evidence: supabaseEvidenceStore(sb), report })
    : undefined;
  const firstAudit =
    publicChecks && pipelineEnabled()
      ? firstAuditRequester({
          request: {
            store: supabasePipelineStore(sb),
            send: (event) => inngest.send(event),
            now: Date.now,
          },
          hasLiveOrGradedCheck: (siteId) => keepStore.hasLiveOrGradedCheck(siteId),
          limits: startLimits,
          paused: () => isCrawlPaused(),
        })
      : undefined;
  return {
    firstLogin: {
      store,
      entitlement: supabaseEntitlementStore(sb),
      admit: (host) => admitSiteHost(host),
      report,
      pepper: pepperFrom(process.env),
      now,
      dispatch: billingDispatcher(process.env),
      firstAudit,
    },
    claim: { store, now, keep, firstAudit, report },
  };
}
