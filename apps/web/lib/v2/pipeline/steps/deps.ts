/**
 * What the step bodies run against. Built per invocation from the environment (functions.ts), or
 * from fakes and PGlite in the tests and the live run.
 */
import type { DailyBudget, renderCheck } from '@crawlmouse/engine/v2/pipeline';
import type { WorkerClient } from '../../../worker-client/types';
import type { DiscoverDeps } from '../discover';
import type { PipelineStore } from '../store';
import type { EvidenceStore, PersistDb } from '../types';

type RenderInput = Parameters<typeof renderCheck>[0];

export interface StepDeps {
  store: PipelineStore;
  evidence: EvidenceStore;
  persistDb: PersistDb;
  /** Null when the environment holds no worker credentials: a post then fails the check. */
  worker: WorkerClient | null;
  /** Milliseconds since the epoch. */
  now: () => number;
  /** A fresh single-use nonce for one POST: 16 to 128 of `[A-Za-z0-9_-]`. */
  nonce: () => string;
  /** Read inside the steps: CRAWL_PAUSED (claim) and VERCEL_GIT_COMMIT_SHA (build). */
  env: Readonly<Record<string, string | undefined>>;
  render: {
    client: RenderInput['client'];
    caps: RenderInput['caps'];
    daily: DailyBudget;
    inFlight: number;
  };
  discover: DiscoverDeps;
}

/**
 * Q7: no durable daily render budget exists yet, and one kept in memory would reset with every
 * Vercel invocation. The pipeline passes this one, which throws, so renderCheck renders nothing and
 * every sampled page records `daily_budget_unavailable` (when a client and caps are configured;
 * without them the page records `not_configured` or `caps_not_configured` first).
 */
export const NO_DAILY_BUDGET: DailyBudget = {
  reserve: async () => {
    throw new Error('no durable daily render budget yet (Q7)');
  },
  settle: async () => {
    throw new Error('no durable daily render budget yet (Q7)');
  },
};
