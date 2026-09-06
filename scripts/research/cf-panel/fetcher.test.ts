import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, it, expect } from 'vitest';
import { withDeadline, withRetry } from './fetcher.js';

const HERE = dirname(fileURLToPath(import.meta.url));

describe('withDeadline', () => {
  /**
   * The regression. `probeDomain('digitaltrends.com')` never settled even though every request
   * inside it carried a 10s AbortSignal.timeout — those timers are unref'd, so when the underlying
   * work also stopped holding the event loop open, Node found an empty loop and exited silently
   * mid-run. Sixteen panel builds died this way with an empty log. A never-settling promise is
   * exactly that shape.
   */
  it('rejects a promise that would otherwise never settle', async () => {
    const never = () => new Promise<string>(() => {});
    await expect(withDeadline(never, 30, 'stuck')).rejects.toThrow(/deadline: stuck exceeded 30ms/);
  });

  it('passes a value through untouched when the work finishes in time', async () => {
    await expect(withDeadline(() => Promise.resolve('ok'), 1000, 'fast')).resolves.toBe('ok');
  });

  it('propagates the original error rather than masking it as a timeout', async () => {
    const boom = () => Promise.reject(new Error('connection refused'));
    await expect(withDeadline(boom, 1000, 'x')).rejects.toThrow('connection refused');
  });

  /**
   * The property a unit test CANNOT observe, checked in a child process instead.
   *
   * Unref'ing the deadline timer still rejects inside a live test runner, because the runner's own
   * event loop keeps the process alive — so the mutation survives here while being the exact defect
   * that killed sixteen builds. The child below leaves the loop with nothing in it but the timer.
   * A ref'd timer prints REJECTED; an unref'd one prints nothing and the process just stops.
   */
  it('holds the process open long enough to reject, rather than letting Node exit silently', async () => {
    const { stdout } = await promisify(execFile)(
      'npx',
      ['tsx', join(HERE, 'fixtures', 'deadline-child.ts')],
      { cwd: join(HERE, '..', '..'), timeout: 60_000 },
    );
    expect(stdout.trim(), 'child printed nothing → Node exited silently on an empty loop').toBe('REJECTED');
  }, 60_000);

  // The timer must be cleared on the happy path, or a completed run would sit waiting for every
  // deadline it ever armed before the process could exit.
  it('does not hold the process open after the work resolves', async () => {
    const started = Date.now();
    await withDeadline(() => Promise.resolve(1), 60_000, 'long');
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('withRetry', () => {
  it('retries a thrown error exactly once', async () => {
    let calls = 0;
    const flaky = async () => {
      calls += 1;
      if (calls === 1) throw new Error('dns');
      return 'second';
    };
    await expect(withRetry(flaky)).resolves.toBe('second');
    expect(calls).toBe(2);
  });

  it('gives up after the one retry rather than looping', async () => {
    let calls = 0;
    const broken = async () => {
      calls += 1;
      throw new Error('always');
    };
    await expect(withRetry(broken)).rejects.toThrow('always');
    expect(calls).toBe(2);
  });

  it('does not retry a resolved value, whatever it contains', async () => {
    let calls = 0;
    const ok = async () => {
      calls += 1;
      return { status: 503 };
    };
    await expect(withRetry(ok)).resolves.toEqual({ status: 503 });
    expect(calls).toBe(1);
  });
});
