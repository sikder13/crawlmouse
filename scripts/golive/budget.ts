/**
 * The Inngest execution budget (CC-35 D2). Inngest's Hobby plan bills each function run and each step
 * (step.run, step.sleep*, step.waitForEvent, step.sendEvent, step.invoke) as one execution, and stops
 * every function once the month's quota is used.
 *
 * A check's count is not written down here: `checkExecutions` runs the real `runCheck`
 * (inngest/check.ts) against a scripted worker and a counting `step`, so the figure moves when the
 * orchestration does. Every other function is a row of `FUNCTIONS`. What `budget.test.ts` checks of
 * the rows: each file's step call sites equal the sum of its rows' `callSites`; each cron row's
 * schedule equals the cron literal in its file, and its runs a day are read from that schedule; each
 * line an event row cites in `stepAt` holds a step call. An event row's `steps` is written by hand from
 * those lines. `docs/ops/inngest-budget.md` is rendered from this module (`renderBudget`), and the same
 * test fails when the file differs from the render.
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
  /**
   * Whether its createFunction options declare `onFailure`. Inngest syncs that handler as a function
   * of its own (`<id>-failure`), so it counts once more in the app's synced function list.
   */
  onFailure: boolean;
  registration: Registration;
  /** The event (or events) that start it; for a cron, `cron \`<schedule>\``. */
  trigger: string;
  /** The cron schedule as its file writes it (budget.test.ts holds them equal), or null for an event. */
  cron: string | null;
  /** Cron runs a day, derived from `cron` (`cronRunsPerDay`); 0 for an event-triggered function. */
  runsPerDay: number;
  /** The step calls written in the function's code (budget.test.ts recounts them per file). */
  callSites: number;
  /** Step calls in one run when there is nothing to do (a cron) or the usual run (an event). */
  steps: number;
  /** How `steps` is reached, citing the step ids. */
  stepsHow: string;
  /**
   * An event row's step calls, as lines of `file` (budget.test.ts checks each holds a step call).
   * An event row's `steps` is written by hand from these lines; nothing derives it from the code.
   */
  stepAt?: readonly number[];
}

/**
 * Runs a day of a five-field cron schedule, for the forms the functions use: a minute field that is a
 * number, `*` or `*\/k`, an hour field that is a number, `*` or `*\/k`, and `*` for day of month, month
 * and day of week. Any other form throws, so a schedule the parser does not read cannot be counted.
 */
export function cronRunsPerDay(cron: string): number {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`cron '${cron}' does not have five fields`);
  const [minute, hour, ...rest] = fields as [string, string, string, string, string];
  if (rest.some((f) => f !== '*'))
    throw new Error(`cron '${cron}' restricts the day; not read here`);
  const per = (field: string, span: number): number => {
    if (field === '*') return span;
    const step = /^\*\/(\d+)$/.exec(field);
    if (step) {
      const k = Number(step[1]);
      if (k < 1 || span % k !== 0)
        throw new Error(`cron '${cron}': step ${field} does not divide ${span}`);
      return span / k;
    }
    if (/^\d+$/.test(field) && Number(field) < span) return 1;
    throw new Error(`cron '${cron}': field '${field}' is not read here`);
  };
  return per(minute, 60) * per(hour, 24);
}

/** A row as written: a cron row names `cron`, an event row names `trigger`. */
type RowInput = Omit<FunctionRow, 'trigger' | 'cron' | 'runsPerDay'> &
  ({ cron: string; trigger?: never } | { trigger: string; cron?: never });

/**
 * Every function a production build can register. The step counts are a run with nothing due: a
 * cron's floor. Event functions' counts are per event.
 */
const ROWS: readonly RowInput[] = [
  // ── v1 ──
  {
    file: 'inngest/audit.ts',
    id: 'crawlmouse.audit',
    onFailure: true,
    callSites: 5,
    registration: 'v1',
    trigger: 'audit.requested',
    steps: 5,
    stepsHow: 'pause-gate, mark-crawling, crawl-and-persist, emit-completed, send-notify-email',
    stepAt: [357, 361, 376, 378, 386],
  },
  {
    file: 'inngest/billing.ts',
    id: 'crawlmouse.stripe-reconcile',
    onFailure: false,
    callSites: 2,
    registration: 'v1',
    cron: '0 3 * * *',
    steps: 2,
    stepsHow: 'reconcile-dry-run; reconcile-accounts in v2 mode (V2_BILLING=1), counted here',
  },
  {
    file: 'inngest/billing.ts',
    id: 'crawlmouse.stripe-reconcile-manual',
    onFailure: false,
    callSites: 1,
    registration: 'v1',
    trigger: 'billing.reconcile.requested',
    steps: 1,
    stepsHow: 'reconcile',
    stepAt: [95],
  },
  {
    file: 'inngest/billing.ts',
    id: 'crawlmouse.audits-ttl-cleanup',
    onFailure: false,
    callSites: 2,
    registration: 'v1',
    cron: '0 4 * * *',
    steps: 2,
    stepsHow: 'delete-expired, prune-rate-limits',
  },
  // ── V2_PIPELINE ──
  {
    file: 'inngest/check.ts',
    id: 'crawlmouse.check.run',
    onFailure: true,
    callSites: 11,
    registration: 'V2_PIPELINE',
    trigger: 'check.requested',
    steps: 0,
    stepsHow: 'measured by checkExecutions (runCheck against a scripted worker)',
  },
  {
    file: 'inngest/check.ts',
    id: 'crawlmouse.check.cancelled',
    onFailure: false,
    callSites: 2,
    registration: 'V2_PIPELINE',
    trigger: 'inngest/function.cancelled (checkFn)',
    steps: 2,
    stepsHow: 'fail, emit-failed',
    stepAt: [445, 447],
  },
  {
    file: 'inngest/check-reaper.ts',
    id: 'crawlmouse.check.reaper',
    onFailure: false,
    callSites: 1,
    registration: 'V2_PIPELINE',
    cron: '*/10 * * * *',
    steps: 1,
    stepsHow: 'reap',
  },
  {
    file: 'inngest/check-expiry.ts',
    id: 'crawlmouse.check.expiry',
    onFailure: false,
    callSites: 2,
    registration: 'V2_PIPELINE',
    cron: '17 5 * * *',
    steps: 2,
    stepsHow: 'expire-unkept, settle-kept',
  },
  // ── V2_BILLING ──
  {
    file: 'inngest/trial-lifecycle.ts',
    id: 'crawlmouse.trial.lifecycle',
    onFailure: false,
    callSites: 6,
    registration: 'V2_BILLING',
    trigger: 'trial.started',
    steps: 6,
    stepsHow: 'reminder-due, remind, remind-effects, trial-ends, expire, expire-effects',
    stepAt: [87, 89, 99, 102, 103, 113],
  },
  {
    file: 'inngest/past-due-sweep.ts',
    id: 'crawlmouse.billing.past-due-sweep',
    onFailure: false,
    callSites: 4,
    registration: 'V2_BILLING',
    cron: '0 * * * *',
    steps: 2,
    stepsHow: 'now, candidates; then two per due account, none when nothing is due',
  },
  // ── V2_CHECKS_PUBLIC ──
  {
    file: 'inngest/deletion.ts',
    id: 'crawlmouse.account.deletion-cancel',
    onFailure: false,
    callSites: 1,
    registration: 'V2_CHECKS_PUBLIC',
    trigger: 'account.deletion_confirmed',
    steps: 1,
    stepsHow: 'cancel',
    stepAt: [73],
  },
  {
    file: 'inngest/deletion.ts',
    id: 'crawlmouse.account.deletion-resume',
    onFailure: false,
    callSites: 1,
    registration: 'V2_CHECKS_PUBLIC',
    trigger: 'account.restored',
    steps: 1,
    stepsHow: 'resume-{id}, one per subscription',
    stepAt: [85],
  },
  {
    file: 'inngest/deletion.ts',
    id: 'crawlmouse.account.purge-deleted',
    onFailure: false,
    callSites: 4,
    registration: 'V2_CHECKS_PUBLIC',
    cron: '30 3 * * *',
    steps: 2,
    stepsHow: 'now, due; then one per person due',
  },
  {
    file: 'inngest/mail.ts',
    id: 'crawlmouse.mail.account',
    onFailure: false,
    callSites: 1,
    registration: 'V2_CHECKS_PUBLIC',
    trigger: 'email.requested',
    steps: 1,
    stepsHow: 'send',
    stepAt: [115],
  },
  {
    file: 'inngest/mail.ts',
    id: 'crawlmouse.mail.check-notify',
    onFailure: false,
    callSites: 1,
    registration: 'V2_CHECKS_PUBLIC',
    trigger: 'check.notify_requested, check.finished, check.failed',
    steps: 1,
    stepsHow: 'send',
    stepAt: [126],
  },
  {
    file: 'inngest/mail.ts',
    id: 'crawlmouse.mail.fix-to-developer',
    onFailure: false,
    callSites: 1,
    registration: 'V2_CHECKS_PUBLIC',
    trigger: 'fix.email_developer_requested',
    steps: 1,
    stepsHow: 'send',
    stepAt: [137],
  },
  {
    file: 'inngest/mail.ts',
    id: 'crawlmouse.events.check-finished',
    onFailure: false,
    callSites: 1,
    registration: 'V2_CHECKS_PUBLIC',
    trigger: 'check.finished',
    steps: 1,
    stepsHow: 'capture',
    stepAt: [153],
  },
  {
    file: 'inngest/mail.ts',
    id: 'crawlmouse.mail.contact-purge',
    onFailure: false,
    callSites: 1,
    registration: 'V2_CHECKS_PUBLIC',
    cron: '43 5 * * *',
    steps: 1,
    stepsHow: 'purge',
  },
  {
    file: 'inngest/mail.ts',
    id: 'crawlmouse.mail.seat-invite',
    onFailure: false,
    callSites: 1,
    registration: 'V2_CHECKS_PUBLIC',
    trigger: 'seat.invite.requested',
    steps: 1,
    stepsHow: 'send',
    stepAt: [164],
  },
  {
    file: 'inngest/mail.ts',
    id: 'crawlmouse.mail.report-confirm',
    onFailure: false,
    callSites: 1,
    registration: 'V2_CHECKS_PUBLIC',
    trigger: 'report.confirmation.requested',
    steps: 1,
    stepsHow: 'send',
    stepAt: [182],
  },
  {
    file: 'inngest/mail.ts',
    id: 'crawlmouse.mail.client-report',
    onFailure: false,
    callSites: 1,
    registration: 'V2_CHECKS_PUBLIC',
    trigger: 'report.send.requested',
    steps: 1,
    stepsHow: 'send',
    stepAt: [195],
  },
  {
    file: 'inngest/report-schedules.ts',
    id: 'crawlmouse.report.schedules',
    onFailure: false,
    callSites: 1,
    registration: 'V2_CHECKS_PUBLIC',
    cron: '7 * * * *',
    steps: 1,
    stepsHow: 'run-due: the due client report schedules, in one step',
  },
  // ── V2_PIPELINE and V2_CHECKS_PUBLIC ──
  {
    file: 'inngest/schedule.ts',
    id: 'crawlmouse.schedule.tick',
    onFailure: false,
    callSites: 5,
    registration: 'V2_PIPELINE+V2_CHECKS_PUBLIC',
    cron: '0 * * * *',
    steps: 2,
    stepsHow: 'pause-gate, claim-0; then request:{site} per site claimed (counted per re-check)',
  },
  {
    file: 'inngest/alerts.ts',
    id: 'crawlmouse.alert.dispatch',
    onFailure: false,
    callSites: 2,
    registration: 'V2_PIPELINE+V2_CHECKS_PUBLIC',
    trigger: 'check.finished',
    steps: 1,
    stepsHow: "plan; then one per channel ('email', 'slack') when an alert fires",
    stepAt: [51, 57],
  },
  {
    file: 'inngest/summary.ts',
    id: 'crawlmouse.summary.tick',
    onFailure: false,
    callSites: 3,
    registration: 'V2_PIPELINE+V2_CHECKS_PUBLIC',
    cron: '11 * * * *',
    steps: 2,
    stepsHow: 'clock, due-0; then request-{page} when a page has summaries due',
  },
  {
    file: 'inngest/summary.ts',
    id: 'crawlmouse.summary.send',
    onFailure: false,
    callSites: 1,
    registration: 'V2_PIPELINE+V2_CHECKS_PUBLIC',
    trigger: 'summary.requested',
    steps: 1,
    stepsHow: 'send',
    stepAt: [88],
  },
];

export const FUNCTIONS: readonly FunctionRow[] = ROWS.map((r): FunctionRow => {
  const cron = r.cron ?? null;
  return {
    ...r,
    cron,
    trigger: cron === null ? r.trigger! : `cron \`${cron}\``,
    runsPerDay: cron === null ? 0 : cronRunsPerDay(cron),
  };
});

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
  /** Busy answers before the worker takes each post (at most PACE.busyRetries); 0 when absent. */
  busyPerPost?: number;
  /** The first read of each batch finds it gone, so the batch is posted once more; false when absent. */
  readFailsFirst?: boolean;
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
];

/** A batch's max_seconds as the post step answers it (apps/web/lib/v2/pipeline/limits.ts). */
export const MAX_SECONDS = 240;

/** The values the heaviest-shape search tries, each a uniform shape over a whole check. */
export const SEARCH = {
  claimWaits: [0, PACE.claimWaits],
  busyPerPost: [0, 1, PACE.busyRetries],
  /** Done at the first, second and third poll, and at the last poll before the deadline. */
  batchSeconds: [PACE.pollStartS, 15, 35, MAX_SECONDS + PACE.pollGraceS - 1],
  readFailsFirst: [false, true],
} as const;

/**
 * The shape with the most executions among `SEARCH`'s combinations, every one with all
 * `PACE.maxCrawlBatches` crawl batches and both access stages, each cut at the run's finish timeout.
 * It is the heaviest of the shapes tried, not a bound: a check whose batches differ from one another
 * is not among them.
 */
export async function heaviestSearched(): Promise<{
  shape: CheckShape;
  executions: number;
  tried: number;
}> {
  let best: { shape: CheckShape; executions: number } | null = null;
  let tried = 0;
  for (const claimWaits of SEARCH.claimWaits)
    for (const busyPerPost of SEARCH.busyPerPost)
      for (const batchSeconds of SEARCH.batchSeconds)
        for (const readFailsFirst of SEARCH.readFailsFirst) {
          const shape: CheckShape = {
            label: 'heaviest searched',
            why: '',
            claimWaits,
            crawlBatches: PACE.maxCrawlBatches,
            accessStages: 2,
            batchSeconds,
            busyPerPost,
            readFailsFirst,
          };
          tried += 1;
          const executions = await checkExecutions(shape);
          if (best === null || executions > best.executions) best = { shape, executions };
        }
  const { shape, executions } = best!;
  const why =
    `the most executions of ${tried} shapes tried (claim waits ${SEARCH.claimWaits.join(' or ')}; ` +
    `${SEARCH.busyPerPost.join(', ')} busy answers a post; batches done at ${SEARCH.batchSeconds.join(', ')} s; ` +
    `a first read that finds the batch gone, or not), all ${PACE.maxCrawlBatches} crawl batches and both access stages, ` +
    `cut at the ${PACE.finishS / 60}-minute finish timeout. This one: ${shape.claimWaits} claim waits, ` +
    `${shape.busyPerPost} busy a post, batches of ${shape.batchSeconds} s, ` +
    `${shape.readFailsFirst ? 'each re-posted once' : 'none re-posted'}. Not a bound: batches that differ from one another are not tried`;
  return { shape: { ...shape, why }, executions, tried };
}

/** The measured shapes and the heaviest searched one, in the order the doc prints them. */
export async function allShapes(): Promise<CheckShape[]> {
  return [...SHAPES, (await heaviestSearched()).shape];
}

const EVENT = {
  checkId: '00000000-0000-4000-8000-000000000001',
  siteId: '00000000-0000-4000-8000-000000000002',
  accountId: '00000000-0000-4000-8000-000000000003',
  host: 'example.test',
  homepageUrl: 'https://example.test/',
} as const;

/** Thrown by the counting `sleep` once the virtual clock passes the run's finish timeout. */
class FinishTimeout extends Error {}

/**
 * The executions of one checkFn run of this shape: 1 for the run, plus each step call runCheck makes
 * against a worker that behaves as `shape` says. The clock is virtual: each sleep advances it, and
 * step.run takes no time. Inngest cancels a run at its finish timeout (`PACE.finishS`), so the sleep
 * that passes it is the last call counted and the run ends there.
 */
export async function checkExecutions(shape: CheckShape): Promise<number> {
  const busyPerPost = shape.busyPerPost ?? 0;
  if (busyPerPost > PACE.busyRetries) {
    throw new Error(`the ${shape.label} shape answers busy more than PACE.busyRetries a post`);
  }
  let now = 0;
  let calls = 0;
  let busy = shape.claimWaits;
  let busyLeft = busyPerPost;
  let postedAt = 0;
  const readFailed = new Set<number>();
  const step: CheckStepTools = {
    run: async (_id, fn) => {
      calls += 1;
      return fn();
    },
    sleep: async (_id, ms) => {
      calls += 1;
      now += ms;
      if (now > PACE.finishS * 1000) throw new FinishTimeout();
    },
    sendEvent: async () => {
      calls += 1;
      return undefined;
    },
  };
  const posted = (): PostOutput => {
    postedAt = now;
    return { status: 'posted', urls: 50, at: now, max_seconds: MAX_SECONDS };
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
      if (busyLeft > 0) {
        busyLeft -= 1;
        return { status: 'busy', at: now };
      }
      busyLeft = busyPerPost;
      if (at.kind === 'crawl') {
        return at.batch <= shape.crawlBatches ? posted() : { status: 'none', why: 'done' };
      }
      return at.stage === 1 || shape.accessStages === 2
        ? posted()
        : { status: 'none', why: 'not_needed' };
    },
    poll: async () => ({
      status: now - postedAt >= shape.batchSeconds * 1000 ? 'done' : 'running',
      at: now,
    }),
    read: async (_e, at) => {
      if (shape.readFailsFirst && !readFailed.has(at.batch)) {
        readFailed.add(at.batch);
        return { status: 'not_found' };
      }
      return {
        status: 'read',
        pages: 50,
        links: 0,
        access_tests: 0,
        partial: false,
        release: 'r',
      };
    },
    failBatch: async () => ({}),
    render: async () => ({ rendered: 0, not_rendered: 0 }),
    build: async () => ({ status: 'finished', pages: 1, fixes: 0 }),
    persist: async () => ({ written: true }),
    finalize: async () => ({}),
    fail: async () => ({ failed: false }),
  };
  let result;
  try {
    result = await runCheck({ event: { data: { ...EVENT } as never }, step, runId: 'r' }, steps);
  } catch (e) {
    if (e instanceof FinishTimeout) return 1 + calls;
    throw e;
  }
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
