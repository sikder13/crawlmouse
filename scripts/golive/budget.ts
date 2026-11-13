/**
 * The Inngest execution budget (CC-35 D2). Inngest's Hobby plan bills each function run and each step
 * (step.run, step.sleep*, step.waitForEvent, step.sendEvent, step.invoke) as one execution, and stops
 * every function once the month's quota is used.
 *
 * A check's count is not written down here: `checkExecutions` runs the real `runCheck`
 * (inngest/check.ts) against a scripted worker and a counting `step`, so the figure moves when the
 * orchestration does. Every other function is a row of `FUNCTIONS` naming the step calls one run
 * makes; `budget.test.ts` counts the step call sites in each function's file and fails when the rows
 * name a different number. `docs/ops/inngest-budget.md` is rendered from this module
 * (`renderBudget`), and the same test fails when the file differs from the render.
 */
import {
  PACE,
  runCheck,
  type CheckStepTools,
  type CheckSteps,
  type PostOutput,
} from '@crawlmouse/inngest/check';

/** Inngest Hobby, read on inngest.com/pricing on 2026-11-13 (brief F5). */
export const HOBBY_MONTHLY_EXECUTIONS = 50_000;
/** D2: with the floor plus 1,000 checks a month above this, the Hobby plan fails the go-live check. */
export const HOBBY_HEADROOM_LINE = 40_000;
/** The month the totals are computed over: the longest, so the floor is not understated. */
export const DAYS_PER_MONTH = 31;

/** Which flag a function is registered under (apps/web/lib/v2/pipeline/functions.ts). */
export type Registration =
  | 'v1'
  | 'V2_PIPELINE'
  | 'V2_BILLING'
  | 'V2_CHECKS_PUBLIC'
  | 'V2_PIPELINE+V2_CHECKS_PUBLIC';

export interface FunctionRow {
  /** The file that calls createFunction for it. */
  file: string;
  /** The Inngest function id. */
  id: string;
  registration: Registration;
  trigger: string;
  /** Cron runs a day; 0 for an event-triggered function. */
  runsPerDay: number;
  /** The step calls written in the function's code (budget.test.ts recounts them per file). */
  callSites: number;
  /** Step calls in one run when there is nothing to do (a cron) or the usual run (an event). */
  steps: number;
  /** How `steps` is reached, citing the step ids. */
  stepsHow: string;
}

const HOURLY = 24;
const EVERY_TEN_MINUTES = 144;
const DAILY = 1;

/**
 * Every function a production build can register. The step counts are a run with nothing due: a
 * cron's floor. Event functions' counts are per event.
 */
export const FUNCTIONS: readonly FunctionRow[] = [
  // ── v1 ──
  {
    file: 'inngest/audit.ts',
    id: 'crawlmouse.audit',
    callSites: 5,
    registration: 'v1',
    trigger: 'audit.requested',
    runsPerDay: 0,
    steps: 5,
    stepsHow: 'pause-gate, mark-crawling, crawl-and-persist, emit-completed, send-notify-email',
  },
  {
    file: 'inngest/billing.ts',
    id: 'crawlmouse.stripe-reconcile',
    callSites: 2,
    registration: 'v1',
    trigger: "cron '0 3 * * *'",
    runsPerDay: DAILY,
    steps: 2,
    stepsHow: 'reconcile-dry-run; reconcile-accounts in v2 mode (V2_BILLING=1), counted here',
  },
  {
    file: 'inngest/billing.ts',
    id: 'crawlmouse.stripe-reconcile-manual',
    callSites: 1,
    registration: 'v1',
    trigger: 'billing.reconcile.requested',
    runsPerDay: 0,
    steps: 1,
    stepsHow: 'reconcile',
  },
  {
    file: 'inngest/billing.ts',
    id: 'crawlmouse.audits-ttl-cleanup',
    callSites: 2,
    registration: 'v1',
    trigger: "cron '0 4 * * *'",
    runsPerDay: DAILY,
    steps: 2,
    stepsHow: 'delete-expired, prune-rate-limits',
  },
  // ── V2_PIPELINE ──
  {
    file: 'inngest/check.ts',
    id: 'crawlmouse.check.run',
    callSites: 11,
    registration: 'V2_PIPELINE',
    trigger: 'check.requested',
    runsPerDay: 0,
    steps: 0,
    stepsHow: 'measured by checkExecutions (runCheck against a scripted worker)',
  },
  {
    file: 'inngest/check.ts',
    id: 'crawlmouse.check.cancelled',
    callSites: 2,
    registration: 'V2_PIPELINE',
    trigger: 'inngest/function.cancelled (checkFn)',
    runsPerDay: 0,
    steps: 2,
    stepsHow: 'fail, emit-failed',
  },
  {
    file: 'inngest/check-reaper.ts',
    id: 'crawlmouse.check.reaper',
    callSites: 1,
    registration: 'V2_PIPELINE',
    trigger: "cron '*/10 * * * *'",
    runsPerDay: EVERY_TEN_MINUTES,
    steps: 1,
    stepsHow: 'reap',
  },
  {
    file: 'inngest/check-expiry.ts',
    id: 'crawlmouse.check.expiry',
    callSites: 2,
    registration: 'V2_PIPELINE',
    trigger: "cron '17 5 * * *'",
    runsPerDay: DAILY,
    steps: 2,
    stepsHow: 'expire-unkept, settle-kept',
  },
  // ── V2_BILLING ──
  {
    file: 'inngest/trial-lifecycle.ts',
    id: 'crawlmouse.trial.lifecycle',
    callSites: 6,
    registration: 'V2_BILLING',
    trigger: 'trial.started',
    runsPerDay: 0,
    steps: 6,
    stepsHow: 'reminder-due, remind, remind-effects, trial-ends, expire, expire-effects',
  },
  {
    file: 'inngest/past-due-sweep.ts',
    id: 'crawlmouse.billing.past-due-sweep',
    callSites: 4,
    registration: 'V2_BILLING',
    trigger: "cron '0 * * * *'",
    runsPerDay: HOURLY,
    steps: 2,
    stepsHow: 'now, candidates; then two per due account, none when nothing is due',
  },
  // ── V2_CHECKS_PUBLIC ──
  {
    file: 'inngest/deletion.ts',
    id: 'crawlmouse.account.deletion-cancel',
    callSites: 1,
    registration: 'V2_CHECKS_PUBLIC',
    trigger: 'account.deletion_confirmed',
    runsPerDay: 0,
    steps: 1,
    stepsHow: 'cancel',
  },
  {
    file: 'inngest/deletion.ts',
    id: 'crawlmouse.account.deletion-resume',
    callSites: 1,
    registration: 'V2_CHECKS_PUBLIC',
    trigger: 'account.restored',
    runsPerDay: 0,
    steps: 1,
    stepsHow: 'resume-{id}, one per subscription',
  },
  {
    file: 'inngest/deletion.ts',
    id: 'crawlmouse.account.purge-deleted',
    callSites: 4,
    registration: 'V2_CHECKS_PUBLIC',
    trigger: "cron '30 3 * * *'",
    runsPerDay: DAILY,
    steps: 2,
    stepsHow: 'now, due; then one per person due',
  },
  {
    file: 'inngest/mail.ts',
    id: 'crawlmouse.mail.account',
    callSites: 1,
    registration: 'V2_CHECKS_PUBLIC',
    trigger: 'email.requested',
    runsPerDay: 0,
    steps: 1,
    stepsHow: 'send',
  },
  {
    file: 'inngest/mail.ts',
    id: 'crawlmouse.mail.check-notify',
    callSites: 1,
    registration: 'V2_CHECKS_PUBLIC',
    trigger: 'check.notify_requested, check.finished, check.failed',
    runsPerDay: 0,
    steps: 1,
    stepsHow: 'send',
  },
  {
    file: 'inngest/mail.ts',
    id: 'crawlmouse.mail.fix-to-developer',
    callSites: 1,
    registration: 'V2_CHECKS_PUBLIC',
    trigger: 'fix.email_developer_requested',
    runsPerDay: 0,
    steps: 1,
    stepsHow: 'send',
  },
  {
    file: 'inngest/mail.ts',
    id: 'crawlmouse.events.check-finished',
    callSites: 1,
    registration: 'V2_CHECKS_PUBLIC',
    trigger: 'check.finished',
    runsPerDay: 0,
    steps: 1,
    stepsHow: 'capture',
  },
  {
    file: 'inngest/mail.ts',
    id: 'crawlmouse.mail.contact-purge',
    callSites: 1,
    registration: 'V2_CHECKS_PUBLIC',
    trigger: "cron '43 5 * * *'",
    runsPerDay: DAILY,
    steps: 1,
    stepsHow: 'purge',
  },
  // ── V2_PIPELINE and V2_CHECKS_PUBLIC ──
  {
    file: 'inngest/schedule.ts',
    id: 'crawlmouse.schedule.tick',
    callSites: 5,
    registration: 'V2_PIPELINE+V2_CHECKS_PUBLIC',
    trigger: "cron '0 * * * *'",
    runsPerDay: HOURLY,
    steps: 2,
    stepsHow: 'pause-gate, claim-0; then request:{site} per site claimed (counted per re-check)',
  },
  {
    file: 'inngest/alerts.ts',
    id: 'crawlmouse.alert.dispatch',
    callSites: 2,
    registration: 'V2_PIPELINE+V2_CHECKS_PUBLIC',
    trigger: 'check.finished',
    runsPerDay: 0,
    steps: 1,
    stepsHow: "plan; then one per channel ('email', 'slack') when an alert fires",
  },
  {
    file: 'inngest/summary.ts',
    id: 'crawlmouse.summary.tick',
    callSites: 3,
    registration: 'V2_PIPELINE+V2_CHECKS_PUBLIC',
    trigger: "cron '11 * * * *'",
    runsPerDay: HOURLY,
    steps: 2,
    stepsHow: 'clock, due-0; then request-{page} when a page has summaries due',
  },
  {
    file: 'inngest/summary.ts',
    id: 'crawlmouse.summary.send',
    callSites: 1,
    registration: 'V2_PIPELINE+V2_CHECKS_PUBLIC',
    trigger: 'summary.requested',
    runsPerDay: 0,
    steps: 1,
    stepsHow: 'send',
  },
];

/** A cron's executions a day with nothing due: its runs, each with its steps. */
export const cronPerDay = (f: FunctionRow): number => f.runsPerDay * (1 + f.steps);

/** The fixed monthly floor: every cron registered once all four flags are on, nothing due. */
export function monthlyFloor(rows: readonly FunctionRow[] = FUNCTIONS): number {
  return rows.reduce((sum, f) => sum + cronPerDay(f), 0) * DAYS_PER_MONTH;
}

/** The flags in switch-on order (docs/ops/go-live.md steps 2–5). */
export const SWITCH_ON = [
  'V2_PIPELINE',
  'V2_ACCOUNT_DOOR',
  'V2_CHECKS_PUBLIC',
  'V2_BILLING',
] as const;
export type Flag = (typeof SWITCH_ON)[number];

/** Whether a row is registered when exactly `on` are set. */
export function registered(f: FunctionRow, on: ReadonlySet<Flag>): boolean {
  return f.registration === 'v1' || f.registration.split('+').every((flag) => on.has(flag as Flag));
}

/** The monthly floor after each switch-on step: the flags of that step and every step before it. */
export function floorBySwitchOn(): { flags: readonly Flag[]; floor: number }[] {
  return SWITCH_ON.map((_, i) => {
    const flags = SWITCH_ON.slice(0, i + 1);
    const on = new Set<Flag>(flags);
    return { flags, floor: monthlyFloor(FUNCTIONS.filter((f) => registered(f, on))) };
  });
}

/** v1's crons alone: what production spends today, before any flag. */
export const v1Floor = (): number => monthlyFloor(FUNCTIONS.filter((f) => f.registration === 'v1'));

// ── a check, measured by running runCheck ──

/** One shape of check: how many batches it posts and how long the worker takes over each. */
export interface CheckShape {
  label: string;
  why: string;
  /** Times the site was busy before the claim succeeded (at most PACE.claimWaits). */
  claimWaits: number;
  crawlBatches: number;
  /** Access stages run: 1, or 2 when stage 2 is needed. */
  accessStages: 1 | 2;
  /** Seconds the worker takes over each batch, crawl and access alike. */
  batchSeconds: number;
}

/**
 * Production's v1 audits, completed in the 30 days to 2026-11-13 (n = 72): median 27 pages and 14 s,
 * 90th percentile 195 pages and 247 s (read-only query over `audits`, recorded in
 * `docs/ops/inngest-budget.md`). A crawl batch is 50 URLs (`CRAWL_BATCH_BUDGET`).
 */
export const SHAPES: readonly CheckShape[] = [
  {
    label: 'typical',
    why: "v1's median audit: 27 pages, one crawl batch, 14 s; access stage 1 only",
    claimWaits: 0,
    crawlBatches: 1,
    accessStages: 1,
    batchSeconds: 14,
  },
  {
    label: 'large',
    why: "v1's 90th percentile: 195 pages, four crawl batches, 247 s in all; both access stages",
    claimWaits: 0,
    crawlBatches: 4,
    accessStages: 2,
    batchSeconds: 62,
  },
  {
    label: 'worst',
    why: `the constants' bound: every claim wait (${PACE.claimWaits}), all ${PACE.maxCrawlBatches} crawl batches, both access stages, each batch done at its first poll`,
    claimWaits: PACE.claimWaits,
    crawlBatches: PACE.maxCrawlBatches,
    accessStages: 2,
    batchSeconds: PACE.pollStartS,
  },
];

const EVENT = {
  checkId: '00000000-0000-4000-8000-000000000001',
  siteId: '00000000-0000-4000-8000-000000000002',
  accountId: '00000000-0000-4000-8000-000000000003',
  host: 'example.test',
  homepageUrl: 'https://example.test/',
} as const;

/**
 * The executions of one checkFn run of this shape: 1 for the run, plus each step call runCheck makes
 * against a worker that behaves as `shape` says. The clock is virtual: each sleep advances it.
 */
export async function checkExecutions(shape: CheckShape): Promise<number> {
  let now = 0;
  let calls = 0;
  let busy = shape.claimWaits;
  let postedAt = 0;
  const crawlPosts = { n: 0 };
  const step: CheckStepTools = {
    run: async (_id, fn) => {
      calls += 1;
      return fn();
    },
    sleep: async (_id, ms) => {
      calls += 1;
      now += ms;
    },
    sendEvent: async () => {
      calls += 1;
      return undefined;
    },
  };
  const posted = (): PostOutput => {
    postedAt = now;
    return { status: 'posted', urls: 50, at: now, max_seconds: 240 };
  };
  const steps: CheckSteps = {
    claim: async () => {
      if (busy > 0) {
        busy -= 1;
        return { outcome: 'site_busy', at: now };
      }
      return { outcome: 'claimed', at: now, site: { ...EVENT } };
    },
    discover: async () => ({ seeds: 1, sitemap_urls: 0, at: now }),
    post: async (_e, at) => {
      if (at.kind === 'crawl') {
        crawlPosts.n += 1;
        return crawlPosts.n <= shape.crawlBatches ? posted() : { status: 'none', why: 'done' };
      }
      return at.stage === 1 || shape.accessStages === 2
        ? posted()
        : { status: 'none', why: 'not_needed' };
    },
    poll: async () => ({
      status: now - postedAt >= shape.batchSeconds * 1000 ? 'done' : 'running',
      at: now,
    }),
    read: async () => ({
      status: 'read',
      pages: 50,
      links: 0,
      access_tests: 0,
      partial: false,
      release: 'r',
    }),
    failBatch: async () => ({}),
    render: async () => ({ rendered: 0, not_rendered: 0 }),
    build: async () => ({ status: 'finished', pages: 1, fixes: 0 }),
    persist: async () => ({ written: true }),
    finalize: async () => ({}),
    fail: async () => ({ failed: false }),
  };
  const result = await runCheck(
    { event: { data: { ...EVENT } as never }, step, runId: 'r' },
    steps,
  );
  if (result.status !== 'finished') {
    throw new Error(`the ${shape.label} check did not finish: ${JSON.stringify(result)}`);
  }
  return 1 + calls;
}

const row = (id: string): FunctionRow => {
  const found = FUNCTIONS.find((f) => f.id === id);
  if (!found) throw new Error(`no function ${id}`);
  return found;
};
const perRun = (id: string): number => 1 + row(id).steps;

/** The functions one finished check starts: the alert planner, the notify mail, the capture. */
export const finishedFanOut = (): number =>
  perRun('crawlmouse.alert.dispatch') +
  perRun('crawlmouse.mail.check-notify') +
  perRun('crawlmouse.events.check-finished');

/** One alert that fires on both channels: the run, its plan, and a step per channel. */
export const alertFiring = (): number => perRun('crawlmouse.alert.dispatch') + 2;
/** One mail: a run and its send step. */
export const oneMail = (): number => perRun('crawlmouse.mail.account');
/** A scheduled re-check adds the tick's `request:{site}` step to the check and its fan-out. */
export const SCHEDULED_REQUEST_STEP = 1;

export interface Scenario {
  label: string;
  executions: number;
}

/** Executions for one first check, one scheduled re-check, one alert and one mail, per check shape. */
export async function scenarios(shape: CheckShape): Promise<Scenario[]> {
  const check = await checkExecutions(shape);
  return [
    { label: 'first check (run, fan-out)', executions: check + finishedFanOut() },
    {
      label: 'scheduled re-check (tick step, run, fan-out)',
      executions: SCHEDULED_REQUEST_STEP + check + finishedFanOut(),
    },
  ];
}

/** Monthly executions at `checks` checks of this shape: the floor plus each check and its fan-out. */
export async function monthlyTotal(checks: number, shape: CheckShape): Promise<number> {
  const perCheck = (await checkExecutions(shape)) + finishedFanOut();
  return monthlyFloor() + checks * perCheck;
}

/** D2's rule: the Hobby plan passes only when the floor plus 1,000 typical checks stays at or under the line. */
export async function hobbyVerdict(): Promise<{ total: number; passes: boolean }> {
  const total = await monthlyTotal(1_000, SHAPES[0]!);
  return { total, passes: total <= HOBBY_HEADROOM_LINE };
}
