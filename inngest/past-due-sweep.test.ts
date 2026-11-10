import { describe, expect, it, vi } from 'vitest';
import { inngest } from './client';
import {
  createPastDueSweepFn,
  PAST_DUE_SWEEP_FN_ID,
  SWEEP_LIMIT,
  type SweepCandidate,
  type SweepClock,
} from './past-due-sweep';
import type { ClockDecision } from './trial-lifecycle';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const NOW = '2099-03-01T10:00:00.000Z';

const applied = (id: string): ClockDecision => ({
  outcome: 'applied',
  reason: null,
  planned: [{ kind: 'send', id }],
});

/**
 * Runs a handler as Inngest does, closely enough for these tests. A step that returns is recorded
 * (through JSON) and returned on every later invocation. A step that throws stops the invocation
 * (the SDK never resumes the handler past it) and is run again on the next one; once it has thrown
 * `attempts` times its error is recorded and thrown into the handler, where code may catch it.
 */
function inngestLike(attempts = 3) {
  const memo = new Map<string, { value: unknown } | { error: Error }>();
  const tries = new Map<string, number>();
  const ran: string[] = [];
  let interrupt: () => void = () => {};
  const step = {
    run: async (id: string, fn: () => unknown) => {
      const seen = memo.get(id);
      if (seen) {
        if ('error' in seen) throw seen.error;
        return seen.value;
      }
      ran.push(id);
      try {
        const value = JSON.parse(JSON.stringify((await fn()) ?? null)) as unknown;
        memo.set(id, { value });
        return value;
      } catch (err) {
        const n = (tries.get(id) ?? 0) + 1;
        tries.set(id, n);
        if (n < attempts) {
          interrupt();
          return new Promise(() => {});
        }
        const error = new Error(`step ${id} failed: ${(err as Error).message}`);
        memo.set(id, { error });
        throw error;
      }
    },
  };
  async function execute(handler: Handler): Promise<{ out: unknown } | { error: Error }> {
    for (;;) {
      const stopped = new Promise<null>((resolve) => {
        interrupt = () => resolve(null);
      });
      const settled = handler({ step }).then(
        (out) => ({ out }),
        (error: Error) => ({ error }),
      );
      const result = await Promise.race([settled, stopped]);
      if (result !== null) return result;
    }
  }
  return { execute, memo, ran };
}

function fakeClock(due: SweepCandidate[], over: Partial<SweepClock> = {}) {
  return {
    now: vi.fn<SweepClock['now']>(over.now ?? (() => Date.parse(NOW))),
    candidates: vi.fn<SweepClock['candidates']>(over.candidates ?? (async () => due)),
    lapse: vi.fn<SweepClock['lapse']>(over.lapse ?? (async (id) => applied(`lapse:${id}`))),
    expire: vi.fn<SweepClock['expire']>(over.expire ?? (async (id) => applied(`expire:${id}`))),
    dispatch: vi.fn<SweepClock['dispatch']>(over.dispatch ?? (async () => {})),
  };
}

type Handler = (ctx: { step: unknown }) => Promise<unknown>;
const handlerOf = (clock: SweepClock) =>
  (createPastDueSweepFn(() => clock) as unknown as { fn: Handler }).fn;

describe('pastDueSweepFn config (CC-03 D9c)', () => {
  it('runs at the top of every hour, one run at a time', () => {
    const [config] = (
      createPastDueSweepFn(() => fakeClock([])) as unknown as {
        getConfig(o: { baseUrl: URL; appPrefix: string }): Record<string, unknown>[];
      }
    ).getConfig({
      baseUrl: new URL('https://crawlmouse.com/api/webhooks/inngest'),
      appPrefix: inngest.id,
    });
    expect(config).toMatchObject({
      id: `crawlmouse-${PAST_DUE_SWEEP_FN_ID}`,
      triggers: [{ cron: '0 * * * *' }],
      concurrency: { limit: 1 },
    });
    expect(PAST_DUE_SWEEP_FN_ID).toBe('crawlmouse.billing.past-due-sweep');
  });
});

describe('pastDueSweepFn steps', () => {
  it('reads the time once, lists at most 100 candidates at it, then applies and sends per account', async () => {
    const clock = fakeClock([
      { accountId: A, kind: 'lapse' },
      { accountId: B, kind: 'expire' },
    ]);
    const { execute, ran } = inngestLike();
    const result = await execute(handlerOf(clock));
    expect(ran).toEqual([
      'now',
      'candidates',
      `lapse-${A}`,
      `lapse-effects-${A}`,
      `expire-${B}`,
      `expire-effects-${B}`,
    ]);
    expect(SWEEP_LIMIT).toBe(100);
    expect(clock.candidates).toHaveBeenCalledWith(new Date(NOW), 100);
    expect(clock.lapse).toHaveBeenCalledWith(A, new Date(NOW));
    expect(clock.expire).toHaveBeenCalledWith(B, new Date(NOW));
    expect(clock.dispatch.mock.calls).toEqual([
      [[{ kind: 'send', id: `lapse:${A}` }]],
      [[{ kind: 'send', id: `expire:${B}` }]],
    ]);
    expect(result).toEqual({ out: { swept: 2, applied: 2, ignored: 0 } });
  });

  it('counts what the machine ignored as ignored', async () => {
    const clock = fakeClock([{ accountId: A, kind: 'lapse' }], {
      lapse: async () => ({
        outcome: 'ignored',
        reason: 'the grace window is still open',
        planned: [],
      }),
    });
    const result = await inngestLike().execute(handlerOf(clock));
    expect(result).toEqual({ out: { swept: 1, applied: 0, ignored: 1 } });
  });

  it('uses the time its first step recorded on every replay, whatever the clock reads later', async () => {
    let calls = 0;
    // The clock moves an hour on every reading; only the `now` step may read it.
    const clock = fakeClock([{ accountId: A, kind: 'lapse' }], {
      now: () => Date.parse(NOW) + 3_600_000 * calls++,
      dispatch: vi
        .fn<SweepClock['dispatch']>()
        .mockRejectedValueOnce(new Error('send failed'))
        .mockResolvedValue(undefined),
    });
    await inngestLike().execute(handlerOf(clock));
    expect(calls).toBe(1);
    expect(clock.lapse).toHaveBeenCalledWith(A, new Date(NOW));
  });

  it('a failed send is retried with the recorded plan; the account is not applied again', async () => {
    const clock = fakeClock([{ accountId: A, kind: 'lapse' }], {
      dispatch: vi
        .fn<SweepClock['dispatch']>()
        .mockRejectedValueOnce(new Error('send failed'))
        .mockResolvedValue(undefined),
    });
    const { execute, memo } = inngestLike();
    const result = await execute(handlerOf(clock));
    expect(clock.lapse).toHaveBeenCalledTimes(1);
    expect(memo.get(`lapse-${A}`)).toEqual({ value: applied(`lapse:${A}`) });
    expect(clock.dispatch.mock.calls).toEqual([
      [[{ kind: 'send', id: `lapse:${A}` }]],
      [[{ kind: 'send', id: `lapse:${A}` }]],
    ]);
    expect(result).toEqual({ out: { swept: 1, applied: 1, ignored: 0 } });
  });

  it('an account that fails every attempt does not stop the others; the run then fails naming it', async () => {
    const clock = fakeClock(
      [
        { accountId: A, kind: 'lapse' },
        { accountId: B, kind: 'lapse' },
      ],
      {
        lapse: async (id) => {
          if (id === A) throw new Error('accounts read failed');
          return applied(`lapse:${id}`);
        },
      },
    );
    const { execute, ran } = inngestLike();
    const result = await execute(handlerOf(clock));
    expect(ran.filter((id) => id === `lapse-${A}`)).toHaveLength(3);
    expect(ran).toContain(`lapse-effects-${B}`);
    expect(clock.dispatch.mock.calls).toEqual([[[{ kind: 'send', id: `lapse:${B}` }]]]);
    expect('error' in result && result.error.name).toBe('NonRetriableError');
    expect('error' in result && result.error.message).toContain(A);
    expect('error' in result && result.error.message).not.toContain(B);
  });

  it('with nothing due it reads the time and the candidates, and nothing else', async () => {
    const clock = fakeClock([]);
    const { execute, ran } = inngestLike();
    expect(await execute(handlerOf(clock))).toEqual({
      out: { swept: 0, applied: 0, ignored: 0 },
    });
    expect(ran).toEqual(['now', 'candidates']);
  });
});
