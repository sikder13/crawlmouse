import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The two timer-based crawl fixtures run in a vitest run of their own, one file at a time, after
// the rest of this suite (docs/ops/ci-timing.md). This file pins that split, and runs in the
// serial run itself, named on its command line, so an edit that narrows the main run cannot
// deselect it; `test (engine)` runs it. It runs the real `test` script line with stand-ins for
// vitest and pnpm, records the vitest command lines the script runs, and lists the files those
// exact command lines select with the real vitest. Removing this file from the serial line would
// switch it off, which no test here can see: that edit is to the line pinned below. So would a
// vitest.config.ts `exclude` of this file alone; a config edit that drops all three files fails,
// because the serial line sets --passWithNoTests=false.

const ENGINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const scripts = JSON.parse(readFileSync(join(ENGINE, 'package.json'), 'utf8')).scripts as Record<
  string,
  string
>;
/** The serial run's files, in command-line order (vitest picks the order it runs them in). */
const SERIAL = [
  'src/test-timers-split.test.ts',
  'src/crawl-stall-retries.test.ts',
  'src/crawl-round-budget.test.ts',
];

/**
 * Runs `test` as pnpm would, `appended` added after it the way `pnpm test -- <args>` adds it. The
 * stand-in vitest records each call's arguments and exits with `exits[call]`; the stand-in pnpm
 * accepts only `run test:timers` and runs the real test:timers line.
 */
function runTest(exits: [number, number], appended = '') {
  const bin = mkdtempSync(join(tmpdir(), 'test-timers-split-'));
  writeFileSync(
    join(bin, 'vitest'),
    `#!/bin/sh
n=$(( $(cat "${bin}/count" 2>/dev/null || echo 0) + 1 )); echo "$n" > "${bin}/count"
printf '%s\\n' "$@" > "${bin}/call-$n"
case "$n" in 1) exit ${exits[0]} ;; 2) exit ${exits[1]} ;; *) exit 98 ;; esac
`,
  );
  writeFileSync(
    join(bin, 'pnpm'),
    `#!/bin/sh\n[ "$*" = "run test:timers" ] || exit 99\nexec sh -c '${scripts['test:timers']}'\n`,
  );
  chmodSync(join(bin, 'vitest'), 0o755);
  chmodSync(join(bin, 'pnpm'), 0o755);
  const r = spawnSync('sh', ['-c', `${scripts.test!}${appended ? ` ${appended}` : ''}`], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  const call = (n: number) =>
    existsSync(join(bin, `call-${n}`))
      ? readFileSync(join(bin, `call-${n}`), 'utf8')
          .replace(/\n$/, '')
          .split('\n')
      : null;
  return { status: r.status, calls: [call(1), call(2), call(3)] };
}

/** The files the real vitest selects for one recorded `vitest run ...` command line. */
function listFiles(runArgs: string[]) {
  expect(runArgs[0]).toBe('run');
  const r = spawnSync('pnpm', ['exec', 'vitest', 'list', '--filesOnly', ...runArgs.slice(1)], {
    cwd: ENGINE,
    encoding: 'utf8',
  });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout
    .split('\n')
    .filter((l) => l.endsWith('.test.ts'))
    .sort();
}

describe('the serial run of the timer-based crawl fixtures', () => {
  it('runs the rest of the suite, then this guard and the two fixtures one file at a time', () => {
    const { calls } = runTest([0, 0]);
    expect(calls[0]).toEqual(['run', ...SERIAL.flatMap((f) => ['--exclude', f])]);
    expect(calls[1]).toEqual([
      'run',
      '--no-file-parallelism',
      '--passWithNoTests=false',
      ...SERIAL,
    ]);
    expect(calls[2]).toBeNull();
    for (const f of SERIAL) expect(existsSync(join(ENGINE, f)), f).toBe(true);
  });

  it('between them, the two command lines select every engine test file once', () => {
    const { calls } = runTest([0, 0]);
    const all = listFiles(['run']);
    const main = listFiles(calls[0]!);
    const serial = listFiles(calls[1]!);
    expect(serial).toEqual([...SERIAL].sort());
    expect(main.filter((f) => serial.includes(f))).toEqual([]);
    expect([...main, ...serial].sort()).toEqual(all);
  }, 60_000);

  it.each([
    [0, 0, 0],
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, 1],
  ])(
    'main run exits %i, serial run exits %i: test exits %i, and the serial run runs either way',
    (main, serial, want) => {
      const r = runTest([main, serial]);
      expect(r.status === 0 ? 0 : 1).toBe(want);
      expect(r.calls[1]).not.toBeNull();
    },
  );

  it('passes the arguments of `pnpm test -- <args>` to the main run', () => {
    // pnpm quotes each argument it appends; one holding a space must arrive as one argument.
    const r = runTest([0, 0], `"src/ssrf-guard.test.ts" "-t" "two words"`);
    expect(r.status).toBe(0);
    expect(r.calls[0]!.slice(-3)).toEqual(['src/ssrf-guard.test.ts', '-t', 'two words']);
    expect(r.calls[1]).toEqual([
      'run',
      '--no-file-parallelism',
      '--passWithNoTests=false',
      ...SERIAL,
    ]);
  });
});
