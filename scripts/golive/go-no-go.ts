/**
 * The go/no-go list (CC-38 D5): every launch gate as data, with how it is checked. Four kinds:
 *
 * - `walk`: one spec of the end-to-end walk (CC-38 D4) under `tests/e2e/`, run locally by the lead on
 *   a production build; its state is read from the Playwright JSON report at `tests/e2e/results.json`.
 * - `golive-step`: `pnpm golive:check -- --step N` passing, one gate per switch-on step of steps.ts.
 * - `ci`: the CI run of the release commit, read in GitHub, not by this module.
 * - `owner`: a drill or a setting only the owner can do, ticked by the owner.
 *
 * `docs/ops/go-no-go.md` is rendered from GATES by `renderGoNoGo` (OPERATING-RULES §10), and
 * go-no-go.test.ts fails when the committed file differs from the render.
 *
 *   pnpm --filter @crawlmouse/scripts exec tsx golive/go-no-go.ts --write
 *
 * `pnpm golive:check -- --go-no-go` prints the list with each gate's state (check.ts, `goNoGoLines`).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { REPO_ROOT } from './env-scan';
import { STEPS, STEP_TITLE, type Step } from './steps';

export type How = 'walk' | 'golive-step' | 'ci' | 'owner';

export interface Gate {
  id: string;
  gate: string;
  how: How;
  /** The file that holds the gate: the spec, the module, the workflow, or the page the owner reads. */
  ref: string;
  detail: string;
}

/** The walk's journeys (CC-38 D4), in the order the brief numbers them. */
export const JOURNEYS = [
  { n: 1, name: 'anonymous', walks: 'anonymous check → result → fix → sign-up → first login' },
  {
    n: 2,
    name: 'free',
    walks:
      'Free: add a site, check, fix packet, mark done, re-check, before/after, the upgrade gate at the second site',
  },
  {
    n: 3,
    name: 'pro-trial',
    walks:
      'Pro trial → upgrade (the Checkout redirect, then the signed webhook) → Pro; cancel; restore',
  },
  {
    n: 4,
    name: 'agency',
    walks:
      'Agency trial → six clients → a developer scoped to one, who sees only that one → client report → share link → proof page → revoke',
    waitsOn:
      "the developer's card and report-mint assertions are todo until CC-37 D5 is on origin/main",
  },
  { n: 5, name: 'settings', walks: 'settings: email change, delete and restore' },
  {
    n: 6,
    name: 'v1-urls',
    walks: "the retired v1 URLs of CC-36's table answer as designed",
    waitsOn: 'todo until CC-36 is on origin/main',
  },
  { n: 7, name: 'support', walks: '/help, /status, the error screen and the support link' },
] as const;

type Journey = (typeof JOURNEYS)[number];

export const specOf = (j: Journey): string => `tests/e2e/${j.n}-${j.name}.spec.ts`;

/** The providers whose accounts must have 2FA on (launch readiness §6, owner actions). */
export const TWO_FACTOR_PROVIDERS = [
  'GitHub',
  'Vercel',
  'Supabase',
  'Stripe',
  'Cloudflare',
  'Sentry',
  'Namecheap',
  'Google',
] as const;

/** The production sites self-audited on the staging worker. */
export const SELF_AUDIT_SITES = ['crawlmouse.com', 'nahltech.com'] as const;

const WALK: readonly Gate[] = JOURNEYS.map((j) => ({
  id: `walk-${j.n}-${j.name}`,
  gate: `journey ${j.n}: ${j.walks}`,
  how: 'walk',
  ref: specOf(j),
  detail: 'waitsOn' in j ? j.waitsOn : '',
}));

const GOLIVE_STEPS: readonly Gate[] = STEPS.map((s) => ({
  id: `golive-step-${s}`,
  gate: `golive:check passes for step ${s} (${STEP_TITLE[s]})`,
  how: 'golive-step',
  ref: 'scripts/golive/steps.ts',
  detail: `\`pnpm golive:check -- --step ${s} --ticked <the manual rows once true>\` exits 0`,
}));

const CI: readonly Gate[] = [
  {
    id: 'ci-release-sha',
    gate: 'CI is green on the release commit',
    how: 'ci',
    ref: '.github/workflows/ci.yml',
    detail:
      'the run of the commit production will serve: `gh run list --workflow ci.yml --commit <sha>`',
  },
];

const OWNER: readonly Gate[] = [
  {
    id: 'restore-drill',
    gate: "restore drill: last night's backup restored into a Supabase branch, and 3 known rows read from it",
    how: 'owner',
    ref: 'docs/specs/v2/38-launch-qa.md',
    detail: 'the three rows chosen before the restore, read by id, their values compared',
  },
  {
    id: 'load-staging',
    gate: 'the k6 load run against staging at 20 concurrent checks',
    how: 'owner',
    ref: 'tests/load/README.md',
    detail:
      'staging only; `ls tests/load` lists no script that requests checks, so the run needs one written first',
  },
  {
    id: 'self-audit',
    gate: `a self-audit of ${SELF_AUDIT_SITES.join(' and ')} on the staging worker, the result looked at`,
    how: 'owner',
    ref: 'docs/ops/worker-runbook.md',
    detail: 'each result read finding by finding; a wrong finding is a no-go',
  },
  {
    id: 'live-purchase',
    gate: 'a real-card live purchase of Pro and of Agency, each refunded',
    how: 'owner',
    ref: 'docs/ops/go-live.md',
    detail: 'after step 5; the plan reaches the account through the live webhook, then the refund',
  },
  {
    id: 'cloudflare-ai-crawlers',
    gate: 'Cloudflare AI crawler controls set to Allow (Search, Agent and Training)',
    how: 'owner',
    ref: 'docs/OPERATING-RULES.md',
    detail: 'OPERATING-RULES §12; Managed robots.txt stays off',
  },
  {
    id: 'provider-2fa',
    gate: '2FA on the provider accounts named in Detail',
    how: 'owner',
    ref: 'docs/specs/v2/38-launch-qa.md',
    detail: TWO_FACTOR_PROVIDERS.join(', '),
  },
];

export const GATES: readonly Gate[] = [...WALK, ...GOLIVE_STEPS, ...CI, ...OWNER];

// ── states, for `golive:check --go-no-go` ──

export const WALK_RESULTS = 'tests/e2e/results.json';
export const WALK_RESULTS_PATH = join(REPO_ROOT, WALK_RESULTS);

/** The four statuses a Playwright JSON report gives a test. */
const TEST_STATUSES = ['expected', 'unexpected', 'flaky', 'skipped'] as const;
type TestStatus = (typeof TEST_STATUSES)[number];
type Counts = Record<TestStatus, number>;

interface ReportSuite {
  file?: unknown;
  specs?: unknown;
  suites?: unknown;
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Adds the status of every test under `suite`, at any depth, to `counts`. */
function countTests(suite: ReportSuite, counts: Counts): void {
  for (const spec of asArray(suite.specs)) {
    for (const test of asArray((spec as { tests?: unknown }).tests)) {
      const status = (test as { status?: unknown }).status;
      if ((TEST_STATUSES as readonly unknown[]).includes(status)) counts[status as TestStatus] += 1;
    }
  }
  for (const child of asArray(suite.suites)) countTests(child as ReportSuite, counts);
}

const SHA = /^[0-9a-f]{40}$/;

export interface WalkResults {
  started: string | null;
  /** The commit the walk ran on: `config.metadata.commit`, set by tests/e2e/playwright.config.ts. */
  commit: string | null;
  files: Map<string, Counts>;
}

/**
 * The walk's results: per spec file (as the report names it, relative to the suite's root) the count
 * of its tests by status, the run's start time and its commit. A string when the text is not a
 * Playwright JSON report.
 */
export function readWalkResults(text: string): WalkResults | string {
  let report: unknown;
  try {
    report = JSON.parse(text);
  } catch {
    return `${WALK_RESULTS} is not JSON`;
  }
  const suites = (report as { suites?: unknown } | null)?.suites;
  if (!Array.isArray(suites)) return `${WALK_RESULTS} is not a Playwright JSON report`;
  const files = new Map<string, Counts>();
  for (const suite of suites as ReportSuite[]) {
    if (typeof suite.file !== 'string') continue;
    const counts = files.get(suite.file) ?? { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
    countTests(suite, counts);
    files.set(suite.file, counts);
  }
  const started = (report as { stats?: { startTime?: unknown } }).stats?.startTime;
  const commit = (report as { config?: { metadata?: { commit?: unknown } } }).config?.metadata
    ?.commit;
  return {
    started: typeof started === 'string' ? started : null,
    commit: typeof commit === 'string' && SHA.test(commit) ? commit : null,
    files,
  };
}

/** A spec's state from its tests' counts: failed, flaky, skipped, passed, or empty. */
export function walkState(c: Counts): string {
  const shown = TEST_STATUSES.filter((s) => c[s] > 0)
    .map((s) => `${c[s]} ${s}`)
    .join(', ');
  if (c.unexpected > 0) return `failed (${shown})`;
  if (c.flaky > 0) return `flaky (${shown})`;
  if (c.expected === 0 && c.skipped > 0) return `skipped (${shown})`;
  if (c.expected === 0) return 'no tests in the report';
  return `passed (${shown})`;
}

/** The report entry for a spec ref: the file whose report path ends the ref. */
function countsOf(files: Map<string, Counts>, ref: string): Counts | undefined {
  for (const [file, counts] of files) if (ref === file || ref.endsWith(`/${file}`)) return counts;
  return undefined;
}

export interface GoNoGoInputs {
  /** Whether `golive:check --step s` would exit 0 in this run, and if not, how many rows block it. */
  step: (s: Step) => { ready: true } | { ready: false; blocking: number };
  /** The text of `tests/e2e/results.json`, or null when there is none. */
  walkResults: string | null;
  /** The live production commit, when the check knows it. */
  live: string | null;
  /** This checkout's HEAD, when git gives it. */
  head: string | null;
}

/**
 * Why the walk's results are not this release's, or undefined when they are (or cannot be compared).
 * The walk is compared with the live production commit when that is known, else with HEAD.
 */
function staleness(walk: WalkResults, inputs: GoNoGoInputs): string | undefined {
  if (walk.commit === null) return 'the report names no commit';
  const [against, name] =
    inputs.live !== null ? [inputs.live, 'the live commit'] : [inputs.head, 'HEAD'];
  if (against === null || walk.commit === against) return undefined;
  return `walked on ${walk.commit.slice(0, 12)}, ${name} is ${against.slice(0, 12)}`;
}

const STEP_OF_GATE = new Map<string, Step>(STEPS.map((s) => [`golive-step-${s}`, s]));

/** The go/no-go section `golive:check --go-no-go` prints: one line per gate, with its state. */
export function goNoGoLines(inputs: GoNoGoInputs, gates: readonly Gate[] = GATES): string[] {
  const walk = inputs.walkResults === null ? null : readWalkResults(inputs.walkResults);
  const lines = ['go/no-go (docs/ops/go-no-go.md):'];
  if (walk === null) lines.push(`  walk: not run (no ${WALK_RESULTS})`);
  else if (typeof walk === 'string') lines.push(`  walk: unknown (${walk})`);
  const stale = walk === null || typeof walk === 'string' ? undefined : staleness(walk, inputs);
  if (walk !== null && typeof walk !== 'string') {
    const compared =
      walk.commit === null
        ? 'on a commit it does not name'
        : `on ${walk.commit.slice(0, 12)}${
            inputs.live === null && inputs.head === null
              ? ' (not compared: neither the live commit nor HEAD is known)'
              : ''
          }`;
    lines.push(
      `  walk: ${WALK_RESULTS}, run started ${walk.started ?? 'at a time it does not give'}, ${compared}`,
    );
  }
  for (const g of gates) {
    let state: string;
    if (g.how === 'walk') {
      if (walk === null) state = 'not run';
      else if (typeof walk === 'string') state = 'unknown';
      else {
        const counts = countsOf(walk.files, g.ref);
        state = counts === undefined ? `not in ${WALK_RESULTS}` : walkState(counts);
        if (stale !== undefined) state = `stale (${stale}; ${state})`;
      }
    } else if (g.how === 'golive-step') {
      const s = STEP_OF_GATE.get(g.id)!;
      const r = inputs.step(s);
      const through = s === 1 ? 'step 1' : `steps 1–${s}`;
      state = r.ready
        ? 'pass'
        : `not ready (${r.blocking} rows gating ${through} do not pass, listed above)`;
    } else if (g.how === 'ci') {
      state = "check the release SHA's run";
    } else {
      state = 'owner-ticked';
    }
    lines.push(`  ${g.id} [${g.how}]: ${state}`);
  }
  return lines;
}

// ── the document ──

export const DOC_PATH = join(REPO_ROOT, 'docs/ops/go-no-go.md');

const HOW_TITLE: Readonly<Record<How, string>> = {
  walk: 'The end-to-end walk',
  'golive-step': 'The go-live check, by step',
  ci: 'CI',
  owner: 'Owner-ticked',
};

const HOW_STATE: Readonly<Record<How, string>> = {
  walk: `the spec's tests in \`${WALK_RESULTS}\` (the Playwright JSON reporter's output), counted by Playwright's statuses (expected, unexpected, flaky, skipped): \`failed\` with an unexpected one, else \`flaky\` with a flaky one, else \`skipped\` with skipped tests only, else \`passed\`; \`not run\` without the file. A state is prefixed \`stale\` when the report's commit (\`config.metadata.commit\`, set by \`tests/e2e/playwright.config.ts\`) is not the live production commit, or HEAD when the live one is unknown, or when the report names none. The walk runs on a production build against the local stand-in with the four flags on, locally, not in CI`,
  'golive-step':
    '`pass` when the rows gating that step and the steps before it pass in the same run, as `--step N` decides it',
  ci: '"check the release SHA\'s run": the check does not read GitHub',
  owner:
    '"owner-ticked": the check cannot see it; the owner records each, with its date, in the launch notes',
};

export async function renderGoNoGo(gates: readonly Gate[] = GATES): Promise<string> {
  const cell = (s: string) => s.replace(/\|/g, '\\|');
  const lines: string[] = [
    '# Go / no-go',
    '',
    '<!-- Rendered by scripts/golive/go-no-go.ts from its GATES. Do not edit by hand:',
    '     change the data and run `pnpm --filter @crawlmouse/scripts exec tsx golive/go-no-go.ts --write`. -->',
    '',
    'v2 goes live for everyone, with no beta. It goes live when the gates below hold. The launch-day',
    'watch and the abort lines are `docs/ops/launch-day.md`; the switch-on order is `docs/ops/go-live.md`.',
    '',
    "Print the list with each gate's state:",
    '',
    '```bash',
    'pnpm golive:check -- --go-no-go --step 5 --ticked <id>,<id>',
    '```',
    '',
    'The go/no-go section is printed after the precondition rows and before the last line. The exit',
    'code is the one `--step` gives without the flag: the walk, CI and owner gates do not change it.',
    'The lines are pinned by `pnpm --filter @crawlmouse/scripts exec vitest run golive/go-no-go.test.ts`.',
  ];
  for (const how of Object.keys(HOW_TITLE) as How[]) {
    const rows = gates.filter((g) => g.how === how);
    if (rows.length === 0) continue;
    lines.push(
      '',
      `## ${HOW_TITLE[how]}`,
      '',
      `State: ${HOW_STATE[how]}.`,
      '',
      '| Id | Gate | Where | Detail |',
      '| --- | --- | --- | --- |',
      ...rows.map((g) => `| \`${g.id}\` | ${cell(g.gate)} | \`${g.ref}\` | ${cell(g.detail)} |`),
    );
  }
  lines.push('');
  // Formatted as CI's Prettier check would leave it, so the check and the byte comparison agree.
  return format(lines.join('\n'), { ...(await resolveConfig(DOC_PATH)), filepath: DOC_PATH });
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1] &&
  process.argv.includes('--write')
) {
  writeFileSync(DOC_PATH, await renderGoNoGo());
  console.log(`wrote ${DOC_PATH}`);
}
