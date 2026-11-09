/**
 * The functions the Inngest serve route registers (D3): v1's four, in today's order; and checkFn, its
 * cancel handler and the reaper only when V2_PIPELINE=1 in the environment the route module loads
 * with. With the flag unset the list is v1's four objects, unchanged (functions.test.ts).
 *
 * What each function is built from (correctness 1): the reaper, the cancel handler and checkFn's
 * onFailure take the pipeline store and nothing else; a check's steps take `stepDeps`, whose worker
 * client is built when a batch step asks for it. A worker variable that does not make a client fails
 * the checks that reach a batch step (`worker_unavailable`); the store-only handlers never build one.
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
import { createCheckCancelledFn, createCheckFn } from '../../../../../inngest/check';
import { createCheckReaperFn } from '../../../../../inngest/check-reaper';
import { pipelineEnabled } from '../../auth/flags';
import { workerClientFromEnv } from '../../worker-client/client';
import { CRAWL_USER_AGENT } from './discover';
import { supabaseEvidenceStore } from './evidence';
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
};

export function inngestFunctions(
  env: Env = process.env,
  wiring: Wiring = SERVICE_WIRING,
): InngestFunction.Like[] {
  const v1 = [auditFn, reconcileBillingFn, reconcileBillingManualFn, cleanupExpiredAuditsFn];
  if (!pipelineEnabled(env)) return v1;
  // Built when a function runs, not when the route loads, so a missing variable cannot keep the
  // route from registering v1's functions.
  return [
    ...v1,
    createCheckFn(
      () => checkSteps(stepDeps(env, wiring.stores(env))),
      (checkId, reason) => failCheck(wiring.store(env), checkId, reason),
      env,
    ),
    createCheckCancelledFn((run) => failCancelled(wiring.store(env), run)),
    createCheckReaperFn(() => reapStalled(wiring.store(env), Date.now)),
  ];
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
