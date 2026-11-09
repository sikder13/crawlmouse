/**
 * The billing functions the Inngest serve route registers after v1's (CC-03 D9): none with
 * V2_BILLING unset, so the route's list is v1's four objects as before; set, trialLifecycleFn and
 * pastDueSweepFn over `billingClock`.
 *
 * It also gives v1's nightly `reconcileBillingFn` its v2 step (D10): `accountReconcileFromEnv` is null
 * with the flag unset, and the nightly run is then v1's step alone.
 */
import { createClient } from '@supabase/supabase-js';
import type { InngestFunction } from 'inngest';
import { setAccountReconcile } from '../../../../inngest/billing';
import { createPastDueSweepFn } from '../../../../inngest/past-due-sweep';
import { createTrialLifecycleFn } from '../../../../inngest/trial-lifecycle';
import { billingClock, supabaseSweepReads, type ClockDeps } from './clock';
import { productionSinks } from './effect-sinks';
import { billingV2Enabled } from './flags';
import { accountReconcileFromEnv } from './reconcile-v2';
import { supabaseEntitlementStore } from './state-machine-apply';

type Env = Readonly<Record<string, string | undefined>>;

export function billingFunctions(env: Env = process.env): InngestFunction.Like[] {
  setAccountReconcile(accountReconcileFromEnv(env));
  if (!billingV2Enabled(env)) return [];
  // Built when a step runs, not when the route loads, so a missing variable cannot keep the route
  // from registering v1's functions.
  const clock = () => billingClock(clockDeps(env));
  return [createTrialLifecycleFn(clock), createPastDueSweepFn(clock)];
}

/** The clock's dependencies from the environment, through the service-role client. */
function clockDeps(env: Env): ClockDeps {
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', {
    auth: { persistSession: false },
  });
  return {
    store: supabaseEntitlementStore(sb),
    reads: supabaseSweepReads(sb),
    sinks: productionSinks(),
    now: Date.now,
  };
}
