import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'perf-retry.sh');

const BUDGET_FAIL =
  '  ✘  2 [chromium] › ../../tests/visual/perf.spec.ts:172:5 › crawl screen performance › the crawl, the map growing: within the budget (1.6m)';
const EXPLORER_FAIL =
  '  ✘  5 [chromium] › ../../tests/visual/perf.spec.ts:215:3 › crawl screen performance › the explorer, 2,000 pages on the canvas: within the budget, no frame over 50 ms as the selection moves (40.1s)';
const CONTROL_FAIL =
  '  ✘  1 [chromium] › ../../tests/visual/perf.spec.ts:150:3 › crawl screen performance › the trace reading finds a long task and a layout shift planted in the page (9.0s)';

/**
 * A stand-in for the Playwright command: each call takes the next outcome from `plan` and prints
 * what the list reporter would. It records its arguments, so a test can see what the retry ran.
 */
/**
 * What one attempt of the stand-in prints: a pass; a budget miss; a failed control; a budget test
 * and the control failing together; a budget-titled test whose measurement was invalid (perf.spec.ts
 * prefixes those assertion messages with MEASUREMENT INVALID); a budget-titled test failing on
 * another assertion (the explorer's canvas never rendering); a budget-titled test timing out; one
 * that threw (Playwright prints a thrown error under its own name); a budget miss beside a budget
 * test that threw; an error that only starts like the budget assertion's; a budget test that printed
 * no error; a budget miss with a second error from teardown; a budget miss beside a budget test that
 * printed nothing; a budget miss then a teardown timeout, coloured as Playwright's workers print it
 * (FORCE_COLOR=1); a budget miss beside a TimeoutError; a budget miss then an error with a Node code
 * in the same test; a budget miss whose ✘ line is coloured; two budget errors under one failed test;
 * a server that never started; or a command that fails having printed nothing. Each failure prints its error as Playwright's list reporter does.
 */
type Outcome =
  | 'pass'
  | 'budget'
  | 'control'
  | 'both'
  | 'invalid'
  | 'canvas'
  | 'timeout'
  | 'thrown'
  | 'budget-and-thrown'
  | 'near-budget'
  | 'silent'
  | 'budget-and-teardown'
  | 'budget-and-silent'
  | 'budget-then-coloured-timeout'
  | 'budget-and-timeout-error'
  | 'nothing'
  | 'budget-then-coded'
  | 'coloured-budget'
  | 'two-budget-errors-one-test'
  | 'crash';

function fakeCommand(dir: string, plan: Array<Outcome>) {
  const path = join(dir, 'fake.sh');
  writeFileSync(join(dir, 'plan'), plan.join('\n') + '\n');
  writeFileSync(
    path,
    `#!/usr/bin/env bash
n=$(( $(cat "${dir}/count" 2>/dev/null || echo 0) + 1 )); echo "$n" > "${dir}/count"
echo "$*" >> "${dir}/args"
outcome=$(sed -n "\${n}p" "${dir}/plan")
echo "[perf] the crawl, the map growing, median: {\\"p95FrameMs\\":16.8}"
case "$outcome" in
  pass) echo "  ✓  2 [chromium] › perf.spec.ts › the crawl: within the budget (30s)"; exit 0 ;;
  budget) echo '${BUDGET_FAIL}'; echo "    Error: medians of 5 runs"; exit 1 ;;
  control) echo '${CONTROL_FAIL}'; exit 1 ;;
  both) echo '${CONTROL_FAIL}'; echo '${BUDGET_FAIL}'; echo "    Error: expect(received).toBeGreaterThanOrEqual(expected)"; echo "    Error: medians of 5 runs"; exit 1 ;;
  invalid) echo '${BUDGET_FAIL}'; echo "    Error: MEASUREMENT INVALID: run 2: only 40 frames"; exit 1 ;;
  canvas) echo '${BUDGET_FAIL}'; echo "    Error: Timed out 15000ms waiting for expect(locator).toHaveCount(expected)"; exit 1 ;;
  timeout) echo '${BUDGET_FAIL}'; echo "    Test timeout of 300000ms exceeded."; exit 1 ;;
  thrown) echo '${BUDGET_FAIL}'; echo "    TypeError: Cannot read properties of undefined (reading 'traceEvents')"; exit 1 ;;
  budget-and-thrown) echo '${BUDGET_FAIL}'; echo "    Error: medians of 5 runs"; echo '${EXPLORER_FAIL}'; echo "    SyntaxError: Unexpected end of JSON input"; exit 1 ;;
  near-budget) echo '${BUDGET_FAIL}'; echo "    Error: medians of 5 runs could not be read: no samples"; exit 1 ;;
  silent) echo '${BUDGET_FAIL}'; exit 1 ;;
  budget-and-teardown) echo '${BUDGET_FAIL}'; echo "    Error: medians of 5 runs"; echo "    TargetClosedError: browserContext.close: Target page, context or browser has been closed"; exit 1 ;;
  budget-and-silent) echo '${BUDGET_FAIL}'; echo "    Error: medians of 5 runs"; echo '${EXPLORER_FAIL}'; exit 1 ;;
  budget-then-coloured-timeout) echo '${BUDGET_FAIL}'; echo "    Error: medians of 5 runs"; printf '    \\033[31mTest timeout of 300000ms exceeded while tearing down "context".\\033[39m\\n'; exit 1 ;;
  budget-and-timeout-error) echo '${BUDGET_FAIL}'; echo "    Error: medians of 5 runs"; echo '${EXPLORER_FAIL}'; echo "    TimeoutError: page.waitForFunction: Timeout 15000ms exceeded."; exit 1 ;;
  crash) echo "Error: Timed out waiting 240000ms from config.webServer."; exit 1 ;;
  nothing) exit 1 ;;
  coloured-budget) printf '\\033[31m%s\\033[39m\\n' '${BUDGET_FAIL}'; echo "    Error: medians of 5 runs"; exit 1 ;;
  two-budget-errors-one-test) echo '${BUDGET_FAIL}'; echo "    Error: medians of 5 runs"; echo "    Error: medians of 5 runs"; exit 1 ;;
  budget-then-coded) echo '${BUDGET_FAIL}'; echo "    Error: medians of 5 runs"; echo "    Error [ERR_INVALID_ARG_TYPE]: The argument is invalid"; exit 1 ;;
esac
`,
    { mode: 0o755 },
  );
  return path;
}

function probeFile(dir: string, rating: 'normal' | 'slow' | 'malformed') {
  const path = join(dir, 'probe.json');
  if (rating === 'malformed') {
    writeFileSync(path, 'Progress: resolved 12\n{"rating":"slow"}\n');
    return path;
  }
  const medianMs = rating === 'slow' ? 210.4 : 101.2;
  writeFileSync(
    path,
    JSON.stringify({ samples: [], medianMs, referenceMs: 100, limitMs: 150, rating }) + '\n',
  );
  return path;
}

function run(plan: Array<Outcome>, probe: 'normal' | 'slow' | 'missing' | 'malformed') {
  const dir = mkdtempSync(join(tmpdir(), 'perf-retry-'));
  const cmd = fakeCommand(dir, plan);
  const probePath = probe === 'missing' ? join(dir, 'absent.json') : probeFile(dir, probe);
  const summary = join(dir, 'summary.md');
  const entry = join(dir, 'flake-entry.md');
  const r = spawnSync('bash', [SCRIPT, probePath, '--', cmd, 'perf.spec.ts'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_STEP_SUMMARY: summary,
      FLAKE_ENTRY: entry,
      RUN_URL: 'https://example.test/runs/1/attempts/1',
    },
  });
  return {
    status: r.status,
    stdout: r.stdout,
    summary: existsSync(summary) ? readFileSync(summary, 'utf8') : '',
    entry: existsSync(entry) ? readFileSync(entry, 'utf8') : null,
    args: readFileSync(join(dir, 'args'), 'utf8').trim().split('\n'),
  };
}

describe('perf-retry.sh: the decision table', () => {
  it('pass: passes after one attempt, with no retry and no register row', () => {
    const r = run(['pass'], 'normal');
    expect(r.status).toBe(0);
    expect(r.args).toEqual(['perf.spec.ts']);
    expect(r.summary).toContain('Passed.');
    expect(r.entry).toBeNull();
  });

  it('fail, then pass: passes as flaky, retrying only the failed tests, and writes a register row', () => {
    const r = run(['budget', 'pass'], 'normal');
    expect(r.status).toBe(0);
    expect(r.args).toEqual(['perf.spec.ts', 'perf.spec.ts --last-failed']);
    expect(r.stdout).toContain('::warning title=flaky: passed on retry::');
    expect(r.entry).toMatch(
      /^\| \d{4}-\d\d-\d\d \| perf\.spec\.ts › the crawl, the map growing: within the budget \| https:\/\/example\.test\/runs\/1\/attempts\/1 \| passed on retry; probe median 101\.2 ms/,
    );
    expect(r.summary).toContain('Attempt 1: failed');
    expect(r.summary).toContain('Attempt 2: passed');
    expect(r.summary).toContain('[perf] the crawl, the map growing, median');
  });

  it('fail twice on a normal runner: fails the job', () => {
    const r = run(['budget', 'budget'], 'normal');
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('::error title=performance budget::failed: reproduced');
    expect(r.entry).toBeNull();
  });

  it('fail twice on a slow runner: passes as inconclusive, with the probe in the summary and the row', () => {
    const r = run(['budget', 'budget'], 'slow');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('::warning title=inconclusive: slow runner::');
    expect(r.summary).toContain(
      'probe median 210.4 ms against reference 100 ms (slow above 150 ms): slow',
    );
    expect(r.entry).toContain('inconclusive: slow runner; probe median 210.4 ms');
  });

  it('fail twice with no probe reading: fails, as on a normal runner', () => {
    const r = run(['budget', 'budget'], 'missing');
    expect(r.status).toBe(1);
    expect(r.summary).toContain(': unknown');
  });

  it('fail twice on a slow runner, but not on a budget: fails', () => {
    expect(run(['budget', 'control'], 'slow').status).toBe(1);
  });

  it('fail twice on a slow runner, a budget test and the control together: fails', () => {
    expect(run(['budget', 'both'], 'slow').status).toBe(1);
  });

  it('fail twice on a slow runner, a budget test whose measurement was invalid: fails', () => {
    expect(run(['budget', 'invalid'], 'slow').status).toBe(1);
  });

  it('fail twice on a slow runner, a budget test failing on another assertion: fails', () => {
    expect(run(['budget', 'canvas'], 'slow').status).toBe(1);
  });

  it('fail twice on a slow runner, a budget test that timed out: fails', () => {
    expect(run(['budget', 'timeout'], 'slow').status).toBe(1);
  });

  it('fail twice on a slow runner, a budget test that threw: fails', () => {
    expect(run(['budget', 'thrown'], 'slow').status).toBe(1);
  });

  it('fail twice on a slow runner, a budget miss beside a budget test that threw: fails', () => {
    expect(run(['budget', 'budget-and-thrown'], 'slow').status).toBe(1);
  });

  it('fail twice on a slow runner, an error that only starts like the budget assertion: fails', () => {
    expect(run(['budget', 'near-budget'], 'slow').status).toBe(1);
  });

  it('fail twice on a slow runner, a budget test that printed no error: fails', () => {
    expect(run(['budget', 'silent'], 'slow').status).toBe(1);
  });

  it('fail twice on a slow runner, a budget miss with a teardown error beside it: fails', () => {
    expect(run(['budget', 'budget-and-teardown'], 'slow').status).toBe(1);
  });

  it('fail twice on a slow runner, a budget miss beside a budget test that printed nothing: fails', () => {
    expect(run(['budget', 'budget-and-silent'], 'slow').status).toBe(1);
  });

  it('fail twice on a slow runner, a budget miss then a coloured timeout in the same test: fails', () => {
    expect(run(['budget', 'budget-then-coloured-timeout'], 'slow').status).toBe(1);
  });

  it('fail twice on a slow runner, a budget miss beside a TimeoutError: fails', () => {
    expect(run(['budget', 'budget-and-timeout-error'], 'slow').status).toBe(1);
  });

  it('fail twice with a probe file that is not one JSON line: fails, as on a normal runner', () => {
    const r = run(['budget', 'budget'], 'malformed');
    expect(r.status).toBe(1);
    expect(r.summary).toContain(': unknown');
  });

  it('fail twice on a slow runner with no failed test listed (the server never started): fails', () => {
    expect(run(['budget', 'crash'], 'slow').status).toBe(1);
  });

  it('fail twice on a slow runner, a budget miss then an error with a Node code in the same test: fails', () => {
    expect(run(['budget', 'budget-then-coded'], 'slow').status).toBe(1);
  });

  it('fail twice on a slow runner, a budget miss whose ✘ line is coloured: inconclusive, as uncoloured', () => {
    const r = run(['budget', 'coloured-budget'], 'slow');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('::warning title=inconclusive: slow runner::');
  });

  it('fail twice on a slow runner, more budget errors than failed tests: fails', () => {
    expect(run(['budget', 'two-budget-errors-one-test'], 'slow').status).toBe(1);
  });

  it('fail twice on a slow runner, having printed no test and no error: fails', () => {
    expect(run(['budget', 'nothing'], 'slow').status).toBe(1);
  });

  it('refuses to run without a command', () => {
    const r = spawnSync('bash', [SCRIPT, 'probe.json', '--'], { encoding: 'utf8' });
    expect(r.status).toBe(2);
  });
});

/** Attempt-1 outcomes that are not budget only: each must fail at once, never reaching a retry. */
const NOT_BUDGET: Outcome[] = [
  'both',
  'invalid',
  'canvas',
  'timeout',
  'thrown',
  'budget-and-thrown',
  'near-budget',
  'silent',
  'budget-and-teardown',
  'budget-and-silent',
  'budget-then-coloured-timeout',
  'budget-and-timeout-error',
  'budget-then-coded',
  'two-budget-errors-one-test',
  'crash',
  'nothing',
];

describe('perf-retry.sh: attempt 1 is classified before any retry', () => {
  // Each plan's second outcome is a pass, so a script that retried would exit 0 as flaky.
  it('a control failure in attempt 1 exits 1 without a second attempt', () => {
    for (const probe of ['normal', 'slow'] as const) {
      const r = run(['control', 'pass'], probe);
      expect(r.status, probe).toBe(1);
      expect(r.args, probe).toEqual(['perf.spec.ts']);
      expect(r.stdout).toContain('::error title=performance budget::failed: not a budget failure');
      expect(r.summary).toContain('**failed: not a budget failure.**');
      expect(r.summary).not.toContain('Attempt 2');
      expect(r.entry, probe).toBeNull();
    }
  });

  it.each(NOT_BUDGET)(
    '%s in attempt 1: fails without a retry, on a normal or a slow runner',
    (o) => {
      for (const probe of ['normal', 'slow'] as const) {
        const r = run([o, 'pass'], probe);
        expect(r.status, probe).toBe(1);
        expect(r.args, probe).toEqual(['perf.spec.ts']);
        expect(r.entry, probe).toBeNull();
      }
    },
  );

  it('a budget miss in attempt 1 whose ✘ line is coloured: is retried, as uncoloured', () => {
    const r = run(['coloured-budget', 'pass'], 'normal');
    expect(r.status).toBe(0);
    expect(r.args).toEqual(['perf.spec.ts', 'perf.spec.ts --last-failed']);
    expect(r.stdout).toContain('::warning title=flaky: passed on retry::');
  });
});
