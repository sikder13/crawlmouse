/**
 * `crawlmouse.competitors.compare` as production wires it (row 18): the service-role client's store,
 * the public start's SSRF guard and limits, the crawl pause, the hide switch, and the pipeline's
 * `requestCheck`. The clients are built when a step runs, not when the serve route loads. The serve
 * route registers it with V2_PIPELINE and V2_CHECKS_PUBLIC both set (lib/v2/pipeline/functions.ts).
 */
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { InngestFunction } from 'inngest';
import { createCompetitorFn, type CompetitorWork } from '../../../../../inngest/competitors';
import { startLimits } from '../../../app/api/checks/_lib/start-limits';
import { admitSiteHost } from '../../auth/admit-site';
import { isCrawlPaused } from '../../crawl-pause';
import { featureShown } from '../../feature-switch';
import { inngest } from '../../inngest';
import { requestCheck } from '../pipeline/request';
import { supabasePipelineStore } from '../pipeline/store';
import { competitorWork, type CompetitorDeps } from './compare';
import { supabaseCompetitorStore } from './store';

type Env = Readonly<Record<string, string | undefined>>;

const serviceClient = (env: Env): SupabaseClient =>
  createClient(env.NEXT_PUBLIC_SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', {
    auth: { persistSession: false },
  });

export function competitorDeps(env: Env): CompetitorDeps {
  const sb = serviceClient(env);
  const pipeline = {
    store: supabasePipelineStore(sb),
    send: inngest.send.bind(inngest),
    now: Date.now,
  };
  return {
    store: supabaseCompetitorStore(sb),
    shown: () => featureShown('competitors', env),
    paused: () => isCrawlPaused(env),
    now: Date.now,
    admit: (host) => admitSiteHost(host),
    limits: { global: () => startLimits.global(), domain: (d) => startLimits.domain(d) },
    newId: randomUUID,
    request: async (siteId, checkId) =>
      (await requestCheck({ ...pipeline, newId: () => checkId }, { siteId, trigger: 'manual' }))
        .checkId,
  };
}

/** The work, with its dependencies built afresh for each step. */
export function competitorWorkFromEnv(env: Env): CompetitorWork {
  const work = () => competitorWork(competitorDeps(env));
  return {
    latest: (siteId) => work().latest(siteId),
    plan: (checkId) => work().plan(checkId),
    start: (host) => work().start(host),
    ended: (ids) => work().ended(ids),
    write: (checkId, entries) => work().write(checkId, entries),
  };
}

export function competitorFunctions(env: Env): InngestFunction.Like[] {
  return [createCompetitorFn(competitorWorkFromEnv(env), env)];
}
