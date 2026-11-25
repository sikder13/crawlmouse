/**
 * What the step bodies run against. Built per invocation from the environment (functions.ts), or
 * from fakes and PGlite in the tests and the live run.
 */
import type { DailyBudget, renderCheck } from '@crawlmouse/engine/v2/pipeline';
import type { WorkerClient } from '../../../worker-client/types';
import type { LedgerDraftSink } from '../../ledger/draft-step';
import type { DiscoverDeps } from '../discover';
import { RENDER_SHARE_S } from '../limits';
import type { PipelineStore } from '../store';
import type { EvidenceStore, PersistDb } from '../types';

type RenderInput = Parameters<typeof renderCheck>[0];

export interface StepDeps {
  store: PipelineStore;
  evidence: EvidenceStore;
  persistDb: PersistDb;
  /**
   * Where the build step stores the check's research-ledger draft (lib/v2/ledger/draft-step.ts).
   * Production's wiring sets it (functions.ts SERVICE_WIRING, pinned by functions.test.ts); a test
   * that leaves it out stores no draft.
   */
  ledger?: LedgerDraftSink;
  /**
   * The worker client, built when a step asks for it (correctness 1): null when the environment holds
   * no worker credentials; it throws when they do not make a client (a malformed key, a URL with no
   * scheme). The batch steps call it through batches.ts `workerOf`, which turns either into the
   * check's `worker_unavailable`.
   */
  worker: () => WorkerClient | null;
  /** Milliseconds since the epoch. */
  now: () => number;
  /** A fresh single-use nonce for one POST: 16 to 128 of `[A-Za-z0-9_-]`. */
  nonce: () => string;
  /** Read inside the steps: CRAWL_PAUSED (claim) and VERCEL_GIT_COMMIT_SHA (build). */
  env: Readonly<Record<string, string | undefined>>;
  render: {
    client: RenderInput['client'];
    caps: RenderInput['caps'];
    /** Used when `dailyFor` is absent. */
    daily: DailyBudget;
    /** The durable budget for one check; production wires it (render-budget.ts). */
    dailyFor?: (checkId: string) => DailyBudget;
    inFlight: number;
    /** Left out in production, so the engine's admission (DNS, the SSRF rule) decides. */
    admit?: RenderInput['admit'];
  };
  discover: DiscoverDeps;
}

/**
 * How long the render step may render, counted from the step's start: its share of the run's reserve
 * after the last batch (`RENDER_SHARE_S` of `RESERVE_S`), so build, persist and finalize keep the
 * rest. Within the step it leaves time of the function's 300 s (`maxDuration`) for settling the
 * budget and storing the outcome.
 */
export const RENDER_STEP_MS = RENDER_SHARE_S * 1000;

/**
 * The budget for a wiring with no durable one: it throws, so renderCheck renders nothing. A sampled
 * page records `daily_budget_unavailable`, or a reason renderCheck finds before it asks the budget
 * (`not_configured`, `caps_not_configured`, `check_cap`). One kept in memory would count per Vercel
 * instance, not per day.
 */
export const NO_DAILY_BUDGET: DailyBudget = {
  reserve: async () => {
    throw new Error('no durable daily render budget yet (Q7)');
  },
  settle: async () => {
    throw new Error('no durable daily render budget yet (Q7)');
  },
};
