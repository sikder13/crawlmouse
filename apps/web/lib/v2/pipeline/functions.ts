/**
 * The functions the Inngest serve route registers (D3): v1's four, in today's order; and checkFn, its
 * cancel handler, the reaper and the daily expiry (CC-22b D8) only when V2_PIPELINE=1 in the
 * environment the route module loads with. CC-03's two billing functions follow, only when
 * V2_BILLING=1, then CC-27b's three deletion functions, the mail functions (CC-28's four, CC-31's
 * three and CC-29's deletion of Agency Plus requests: lib/v2/mail/functions.ts) and CC-31's client
 * report schedules, only when V2_CHECKS_PUBLIC=1. CC-28's scheduler tick, alert and summary
 * functions are registered only when both V2_PIPELINE=1 and V2_CHECKS_PUBLIC=1. CC-33's three founder
 * functions (with their failure handlers) come last, when either V2_BILLING=1 or V2_CHECKS_PUBLIC=1,
 * and its sign-in canary when SIGNIN_CANARY_TO is one plain address, whatever the flags. With the
 * flags and SIGNIN_CANARY_TO unset the list is v1's four objects, unchanged (functions.test.ts).
 *
 * What each function is built from (correctness 1): the reaper, the cancel handler and checkFn's
 * onFailure take the pipeline store and nothing else; the expiry takes its own stores and the
 * evidence bucket (`wiring.expiry`); a check's steps are `checkStepsFromEnv`'s, over
 * `stepDeps`, whose worker client is built when a batch step asks for it. A worker variable that does
 * not make a client fails the checks that reach a batch step (`worker_unavailable`); the store-only
 * handlers never build one.
 */
import { randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { InngestFunction } from 'inngest';
import {
  capsFromEnv,
  clientFromEnv,
  inFlightFromEnv,
  safeFetch,
} from '@crawlmouse/engine/v2/pipeline';
import { auditFn } from '../../../../../inngest/audit';
import {
  cleanupExpiredAuditsFn,
  reconcileBillingFn,
  reconcileBillingManualFn,
} from '../../../../../inngest/billing';
import {
  createCheckCancelledFn,
  createCheckFn,
  type CheckSteps,
} from '../../../../../inngest/check';
import { createExpireAnonymousChecksFn } from '../../../../../inngest/check-expiry';
import { createCheckReaperFn } from '../../../../../inngest/check-reaper';
import { checksPublicEnabled, pipelineEnabled } from '../../auth/flags';
import { billingFunctions } from '../../billing/inngest-functions';
import { deletionFunctions } from '../account/deletion-ports';
import { scheduleFunctions } from '../monitor/schedule';
import { mailFunctions } from '../mail/functions';
import { reportScheduleFunctions } from '../agency/schedules-wiring';
import { workerClientFromEnv } from '../../worker-client/client';
import { monitorFunctions } from '../monitor/functions';
import { opsFunctions } from '../ops/functions';
import { CRAWL_USER_AGENT } from './discover';
import { supabaseEvidenceStore } from './evidence';
import { expireUnkept, settleKept, type ExpireDeps } from './expire';
import { supabaseExpireStore } from './expire-store';
import { supabaseKeepStore } from './keep-store';
import { supabasePersistDb } from './persist';
import {
  checkSteps,
  failCancelled,
  failCheck,
  NO_DAILY_BUDGET,
  reapStalled,
  type StepDeps,
} from './steps';
import { supabasePipelineStore, type PipelineStore } from './store';

type Env = Readonly<Record<string, string | undefined>>;

/** The stores a check's steps read and write. */
export type StepStores = Pick<StepDeps, 'store' | 'evidence' | 'persistDb'>;

/** Where the functions get their stores. Production's go through the service-role client. */
export interface Wiring {
  /** The pipeline store alone: what the reaper, the cancel handler and onFailure use. */
  store(env: Env): PipelineStore;
  /** The three stores a check's steps use. */
  stores(env: Env): StepStores;
  /** What the daily expiry reads, deletes and moves with. */
  expiry(env: Env): ExpireDeps;
}

const serviceClient = (env: Env): SupabaseClient =>
  createClient(env.NEXT_PUBLIC_SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', {
    auth: { persistSession: false },
  });

export const SERVICE_WIRING: Wiring = {
  store: (env) => supabasePipelineStore(serviceClient(env)),
  stores: (env) => {
    const sb = serviceClient(env);
    return {
      store: supabasePipelineStore(sb),
      evidence: supabaseEvidenceStore(sb),
      persistDb: supabasePersistDb(sb),
    };
  },
  expiry: (env) => {
    const sb = serviceClient(env);
    const evidence = supabaseEvidenceStore(sb);
    return {
      store: supabaseExpireStore(sb),
      evidence,
      keep: {
        store: supabaseKeepStore(sb),
        evidence,
        report: (signal, extra) =>
          console.warn(JSON.stringify({ event: `expiry.${signal}`, ...extra })),
      },
      now: Date.now,
    };
  },
};

export function inngestFunctions(
  env: Env = process.env,
  wiring: Wiring = SERVICE_WIRING,
): InngestFunction.Like[] {
  const v1 = [auditFn, reconcileBillingFn, reconcileBillingManualFn, cleanupExpiredAuditsFn];
  // CC-03's trial and past-due functions, with V2_BILLING=1 only; none, and the nightly reconcile
  // left as v1's step, with it unset (lib/billing/inngest-functions.ts).
  const billing = billingFunctions(env);
  // CC-27b's deletion functions, with V2_CHECKS_PUBLIC=1 only (lib/v2/account/deletion-ports.ts).
  const deletion = checksPublicEnabled(env) ? deletionFunctions(env) : [];
  // The mail functions, the check_finished listener and CC-29's contact purge, with
  // V2_CHECKS_PUBLIC=1 only (lib/v2/mail/functions.ts).
  const mail = checksPublicEnabled(env) ? mailFunctions(env) : [];
  // CC-31's client report schedules, with V2_CHECKS_PUBLIC=1 only (lib/v2/agency/schedules-wiring.ts).
  const reports = checksPublicEnabled(env) ? reportScheduleFunctions(env) : [];
  // CC-33's founder notices, with V2_BILLING=1 or V2_CHECKS_PUBLIC=1, and its sign-in canary on
  // SIGNIN_CANARY_TO alone (lib/v2/ops/functions.ts).
  const ops = opsFunctions(env);
  if (!pipelineEnabled(env)) return [...v1, ...billing, ...deletion, ...mail, ...reports, ...ops];
  // Built when a function runs, not when the route loads, so a missing variable cannot keep the
  // route from registering v1's functions.
  return [
    ...v1,
    createCheckFn(
      () => checkStepsFromEnv(env, wiring.stores(env)),
      (checkId, reason) => failCheck(wiring.store(env), checkId, reason),
      env,
    ),
    createCheckCancelledFn((run) => failCancelled(wiring.store(env), run)),
    createCheckReaperFn(() => reapStalled(wiring.store(env), Date.now)),
    createExpireAnonymousChecksFn({
      expireUnkept: () => expireUnkept(wiring.expiry(env)),
      settleKept: () => settleKept(wiring.expiry(env)),
    }),
    ...billing,
    ...deletion,
    ...mail,
    // CC-28's scheduler tick, with V2_CHECKS_PUBLIC=1 as well (lib/v2/monitor/schedule.ts).
    ...(checksPublicEnabled(env) ? scheduleFunctions(env) : []),
    // CC-28's alerts and weekly summary, with V2_CHECKS_PUBLIC=1 as well (lib/v2/monitor/functions.ts).
    ...(checksPublicEnabled(env) ? monitorFunctions(env) : []),
    ...reports,
    ...ops,
  ];
}

/** A check's step bodies as checkFn runs them in production: checkSteps over stepDeps. */
export function checkStepsFromEnv(env: Env, stores: StepStores): CheckSteps {
  return checkSteps(stepDeps(env, stores));
}

/**
 * The step bodies' dependencies as production wires them, over `stores`: the worker client built
 * from the environment when a batch step asks for it, discovery through the engine's `safeFetch`
 * (the SSRF guard, §5), and rendering with the refusing daily budget (Q7).
 */
export function stepDeps(env: Env, stores: StepStores): StepDeps {
  return {
    store: stores.store,
    evidence: stores.evidence,
    persistDb: stores.persistDb,
    worker: () => workerClientFromEnv(env),
    now: Date.now,
    // 32 characters of [A-Za-z0-9_-], which the worker's nonce rule takes.
    nonce: () => randomBytes(24).toString('base64url'),
    env,
    render: {
      client: clientFromEnv(env),
      caps: capsFromEnv(env),
      daily: NO_DAILY_BUDGET,
      inFlight: inFlightFromEnv(env),
    },
    discover: { fetch: safeFetch, userAgent: CRAWL_USER_AGENT, now: Date.now },
  };
}
