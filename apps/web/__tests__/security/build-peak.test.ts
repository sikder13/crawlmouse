/**
 * `.github/workflows/scripts/build-peak.sh` (CTO 094): CI's build reports the most memory its whole
 * process tree held, and fails above `BUILD_PEAK_BUDGET_MB`. Each case runs the real script around a
 * Node process that holds a known amount of memory, so the check is shown able to fail.
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = resolve(__dirname, '../../../../.github/workflows/scripts/build-peak.sh');
/** A process that holds about 300 MB for two and a half seconds. */
const HOLD = ['-e', 'const b=Buffer.alloc(300*1024*1024,1);setTimeout(()=>b.length,2500)'];

const run = (budget: string | undefined, cmd: string[]) =>
  spawnSync(SCRIPT, cmd, {
    encoding: 'utf8',
    env: { ...process.env, BUILD_PEAK_BUDGET_MB: budget ?? '' },
  });

const peakOf = (out: string) => Number(/process tree peak (\d+) MB/.exec(out)?.[1]);

describe('build-peak.sh', () => {
  it('reports the peak of the process tree it ran', () => {
    const r = run(undefined, [process.execPath, ...HOLD]);
    expect(r.status).toBe(0);
    expect(peakOf(r.stdout)).toBeGreaterThanOrEqual(300);
    expect(r.stdout).toMatch(/largest single process \d+ KB/);
  }, 30_000);

  it('fails a command that holds more than the budget, and says so', () => {
    const r = run('100', [process.execPath, ...HOLD]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/MB is over the 100 MB budget/);
  }, 30_000);

  it('passes the same command under a budget it stays inside', () => {
    expect(run('4000', [process.execPath, ...HOLD]).status).toBe(0);
  }, 30_000);

  it('keeps a failing command’s own exit status', () => {
    const r = run('4000', ['sh', '-c', 'exit 3']);
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/failed with exit status 3/);
  }, 30_000);
});
