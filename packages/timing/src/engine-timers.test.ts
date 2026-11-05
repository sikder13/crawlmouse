import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The engine's two timer-based crawl fixtures run in a vitest run of their own, one file at a
// time, after the rest of the engine suite (docs/ops/ci-timing.md). These tests pin that split:
// the main run leaves out exactly the files the serial run runs, and a failure in either run
// fails `test`.

const ENGINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'engine');
const scripts = JSON.parse(readFileSync(join(ENGINE, 'package.json'), 'utf8')).scripts as Record<
  string,
  string
>;
const excluded = [...scripts.test!.matchAll(/--exclude ([^\s;&|]+)/g)].map((m) => m[1]!);
const timers = scripts['test:timers']!.split(/\s+/).filter((a) => a.endsWith('.test.ts'));

const listFiles = (args: string[]) => {
  const r = spawnSync('pnpm', ['exec', 'vitest', 'list', '--filesOnly', ...args], {
    cwd: ENGINE,
    encoding: 'utf8',
  });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout
    .split('\n')
    .filter((l) => l.endsWith('.test.ts'))
    .sort();
};

describe("the engine's serial run of its timer-based fixtures", () => {
  it('runs the files the main run leaves out, one at a time, and both files exist', () => {
    expect(timers.length).toBeGreaterThan(0);
    expect([...excluded].sort()).toEqual([...timers].sort());
    for (const f of timers) expect(existsSync(join(ENGINE, f)), f).toBe(true);
    expect(scripts['test:timers']).toMatch(/^vitest run --no-file-parallelism /);
  });

  it('between them, the two runs cover every engine test file once', () => {
    const all = listFiles([]);
    const main = listFiles(excluded.flatMap((f) => ['--exclude', f]));
    const serial = listFiles(timers);
    expect(serial).toEqual([...timers].sort());
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
      // Stand-ins for vitest and pnpm on PATH: vitest exits with the status planned for its run,
      // and `pnpm run test:timers` runs the real test:timers script line.
      const bin = mkdtempSync(join(tmpdir(), 'engine-timers-'));
      const ran = join(bin, 'ran');
      writeFileSync(
        join(bin, 'vitest'),
        `#!/bin/sh\ncase "$*" in *--exclude*) exit ${main} ;; *) echo serial >> "${ran}"; exit ${serial} ;; esac\n`,
      );
      writeFileSync(
        join(bin, 'pnpm'),
        `#!/bin/sh\n[ "$*" = "run test:timers" ] || exit 99\nexec sh -c '${scripts['test:timers']}'\n`,
      );
      chmodSync(join(bin, 'vitest'), 0o755);
      chmodSync(join(bin, 'pnpm'), 0o755);
      const r = spawnSync('sh', ['-c', scripts.test!], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      });
      expect(r.status === 0 ? 0 : 1).toBe(want);
      expect(existsSync(ran) ? readFileSync(ran, 'utf8') : '').toBe('serial\n');
    },
  );
});
