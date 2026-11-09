/**
 * The functions the Inngest serve route registers (D3): v1's four, in today's order; and checkFn, its
 * cancel handler and the reaper only when V2_PIPELINE=1 in the environment the route module loads
 * with. With the flag unset the list is v1's four objects, unchanged (functions.test.ts).
 */
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
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
import { checkSteps, failCancelled, NO_DAILY_BUDGET, reapStalled, type StepDeps } from './steps';
import { supabasePipelineStore } from './store';

type Env = Readonly<Record<string, string | undefined>>;

export function inngestFunctions(env: Env = process.env): InngestFunction.Like[] {
  const v1 = [auditFn, reconcileBillingFn, reconcileBillingManualFn, cleanupExpiredAuditsFn];
  if (!pipelineEnabled(env)) return v1;
  // Built when a function runs, not when the route loads, so a missing variable cannot keep the
  // route from registering v1's functions.
  const deps = () => stepDeps(env);
  return [
    ...v1,
    createCheckFn(() => checkSteps(deps()), env),
    createCheckCancelledFn((runId) => failCancelled(deps().store, runId)),
    createCheckReaperFn(() => reapStalled(deps().store, Date.now)),
  ];
}

/** The step bodies' dependencies from the environment, through the service-role client. */
function stepDeps(env: Env): StepDeps {
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', {
    auth: { persistSession: false },
  });
  return {
    store: supabasePipelineStore(sb),
    evidence: supabaseEvidenceStore(sb),
    persistDb: supabasePersistDb(sb),
    worker: workerClientFromEnv(env),
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
