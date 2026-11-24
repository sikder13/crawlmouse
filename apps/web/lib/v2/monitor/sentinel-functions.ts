/**
 * The daily sentinel's two functions as production wires them (row 23): the service-role client's
 * store, the worker client from the environment, the crawl pause, the hide switch, the day's ceiling
 * on starts, and `requestCheck` with the sentinel's day key. Clients are built when a step runs, not
 * when the serve route loads. The serve route registers these with V2_PIPELINE and V2_CHECKS_PUBLIC
 * both set (lib/v2/pipeline/functions.ts).
 */
import { randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { InngestFunction } from 'inngest';
import {
  createSentinelTickFn,
  createSentinelWatchFn,
  type SentinelSteps,
} from '../../../../../inngest/sentinel';
import { startLimits } from '../../../app/api/checks/_lib/start-limits';
import { isCrawlPaused } from '../../crawl-pause';
import { featureShown } from '../../feature-switch';
import { inngest } from '../../inngest';
import { workerClientFromEnv } from '../../worker-client/client';
import { requestCheck } from '../pipeline/request';
import { supabasePipelineStore } from '../pipeline/store';
import { supabaseSentinelStore } from './sentinel-store';
import { sentinelWork, type SentinelDeps } from './sentinel-work';

type Env = Readonly<Record<string, string | undefined>>;

const serviceClient = (env: Env): SupabaseClient =>
  createClient(env.NEXT_PUBLIC_SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', {
    auth: { persistSession: false },
  });

export function sentinelDeps(env: Env): SentinelDeps {
  const sb = serviceClient(env);
  const pipeline = {
    store: supabasePipelineStore(sb),
    send: inngest.send.bind(inngest),
    now: Date.now,
  };
  return {
    store: supabaseSentinelStore(sb),
    shown: () => featureShown('sentinel', env),
    paused: () => isCrawlPaused(env),
    now: Date.now,
    worker: () => workerClientFromEnv(env),
    // 32 characters of [A-Za-z0-9_-], which the worker's nonce rule takes.
    nonce: () => randomBytes(24).toString('base64url'),
    global: () => startLimits.global(),
    request: async (siteId, day) =>
      (
        await requestCheck(
          { ...pipeline, newId: () => crypto.randomUUID() },
          { siteId, trigger: 'scheduled', sentinelDay: day },
        )
      ).checkId,
  };
}

/** The steps, with their dependencies built afresh for each step. */
export function sentinelStepsFromEnv(env: Env): SentinelSteps {
  const work = () => sentinelWork(sentinelDeps(env));
  return {
    due: (hour) => work().due(hour),
    plan: (siteId) => work().plan(siteId),
    look: (siteId, host, pages, n) => work().look(siteId, host, pages, n),
    result: (siteId, batchId) => work().result(siteId, batchId),
    request: (siteId) => work().request(siteId),
  };
}

export function sentinelFunctions(env: Env): InngestFunction.Like[] {
  const steps = sentinelStepsFromEnv(env);
  return [createSentinelTickFn(steps, env), createSentinelWatchFn(steps, env)];
}
