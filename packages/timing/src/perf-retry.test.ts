import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'perf-retry.sh');

const BUDGET_FAIL =
  '  ✘  2 [chromium] › ../../tests/visual/perf.spec.ts:172:5 › crawl screen performance › the crawl, the map growing: within the budget (1.6m)';
const CONTROL_FAIL =
  '  ✘  1 [chromium] › ../../tests/visual/perf.spec.ts:150:3 › crawl screen performance › the trace reading finds a long task and a layout shift planted in the page (9.0s)';

/**
 * A stand-in for the Playwright command: each call takes the next outcome from `plan` and prints
 * what the list reporter would. It records its arguments, so a test can see what the retry ran.
 */
/**
 * What one attempt of the stand-in prints: a pass; a budget miss; a failed control; a budget test
 * and the control failing together; a budget-titled test whose measurement was invalid (perf.spec.ts
 * prefixes those assertion messages with MEASUREMENT INVALID); or a server that never started.
 */
type Outcome = 'pass' | 'budget' | 'control' | 'both' | 'invalid' | 'crash';

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
  budget) echo '${BUDGET_FAIL}'; exit 1 ;;
  control) echo '${CONTROL_FAIL}'; exit 1 ;;
  both) echo '${CONTROL_FAIL}'; echo '${BUDGET_FAIL}'; exit 1 ;;
  invalid) echo '${BUDGET_FAIL}'; echo "    Error: MEASUREMENT INVALID: run 2: only 40 frames"; exit 1 ;;
  crash) echo "Error: Timed out waiting 240000ms from config.webServer."; exit 1 ;;
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
    expect(run(['control', 'control'], 'slow').status).toBe(1);
    expect(run(['budget', 'control'], 'slow').status).toBe(1);
  });

  it('fail twice on a slow runner, a budget test and the control together: fails', () => {
    expect(run(['budget', 'both'], 'slow').status).toBe(1);
    expect(run(['both', 'both'], 'slow').status).toBe(1);
  });

  it('fail twice on a slow runner, a budget test whose measurement was invalid: fails', () => {
    expect(run(['budget', 'invalid'], 'slow').status).toBe(1);
  });

  it('fail twice with a probe file that is not one JSON line: fails, as on a normal runner', () => {
    const r = run(['budget', 'budget'], 'malformed');
    expect(r.status).toBe(1);
    expect(r.summary).toContain(': unknown');
  });

  it('fail twice on a slow runner with no failed test listed (the server never started): fails', () => {
    expect(run(['crash', 'crash'], 'slow').status).toBe(1);
  });

  it('refuses to run without a command', () => {
    const r = spawnSync('bash', [SCRIPT, 'probe.json', '--'], { encoding: 'utf8' });
    expect(r.status).toBe(2);
  });
});
