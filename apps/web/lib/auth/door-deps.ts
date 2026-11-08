import 'server-only';
import * as Sentry from '@sentry/nextjs';
import { supabaseAdmin } from '../supabase/admin';
import { supabaseEntitlementStore } from '../billing/state-machine-apply';
import type { ClaimDeps } from './claim';
import type { FirstLoginDeps } from './first-login';
import { pepperFrom } from './ledger';
import { admitSiteHost } from './admit-site';
import { sentryReport, supabaseDoorStore } from './stores';

/** The door's production dependencies: the service-role client and Sentry. */
export function doorDeps(): { firstLogin: FirstLoginDeps; claim: ClaimDeps } {
  const sb = supabaseAdmin();
  const store = supabaseDoorStore(sb);
  const now = () => new Date();
  return {
    firstLogin: {
      store,
      entitlement: supabaseEntitlementStore(sb),
      admit: (host) => admitSiteHost(host),
      report: sentryReport((m, ctx) => Sentry.captureMessage(m, ctx)),
      pepper: pepperFrom(process.env),
      now,
    },
    claim: { store, now },
  };
}
