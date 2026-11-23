import { describe, expect, it, vi } from 'vitest';
import { inngest } from './client';
import {
  createTrialClockFn,
  TRIAL_CLOCK_FN_ID,
  TRIAL_CLOCK_LIMIT,
  type TrialClockDue,
  type TrialClockPorts,
} from './trial-clock';
import type { ClockDecision } from './trial-lifecycle';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const NOW = '2099-03-01T10:20:00.000Z';

const applied = (id: string): ClockDecision => ({
  outcome: 'applied',
  reason: null,
  planned: [{ kind: 'send', id }],
});

type Handler = (ctx: { step: unknown }) => Promise<unknown>;

/** Runs a handler as Inngest does: a recorded step is replayed, a failing one retried, then thrown in. */
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

function fakeClock(due: TrialClockDue[], over: Partial<TrialClockPorts> = {}) {
  return {
    now: vi.fn<TrialClockPorts['now']>(over.now ?? (() => Date.parse(NOW))),
    due: vi.fn<TrialClockPorts['due']>(
      over.due ?? (async () => ({ due, reminderReadFailed: false })),
    ),
    remind: vi.fn<TrialClockPorts['remind']>(
      over.remind ?? (async (id) => applied(`remind:${id}`)),
    ),
    expire: vi.fn<TrialClockPorts['expire']>(
      over.expire ?? (async (id) => applied(`expire:${id}`)),
    ),
    dispatch: vi.fn<TrialClockPorts['dispatch']>(over.dispatch ?? (async () => {})),
  };
}

const handlerOf = (clock: TrialClockPorts) =>
  (createTrialClockFn(() => clock) as unknown as { fn: Handler }).fn;

describe('trialClockFn config', () => {
  it('runs once an hour, off the hour, one run at a time', () => {
    const [config] = (
      createTrialClockFn(() => fakeClock([])) as unknown as {
        getConfig(o: { baseUrl: URL; appPrefix: string }): Record<string, unknown>[];
      }
    ).getConfig({
      baseUrl: new URL('https://crawlmouse.com/api/webhooks/inngest'),
      appPrefix: inngest.id,
    });
    expect(config).toMatchObject({
      id: `crawlmouse-${TRIAL_CLOCK_FN_ID}`,
      triggers: [{ cron: '20 * * * *' }],
      concurrency: { limit: 1 },
    });
    expect(TRIAL_CLOCK_FN_ID).toBe('crawlmouse.trial.clock');
  });
});

describe('trialClockFn steps', () => {
  it('reads the time once, lists at most 100, then applies and sends per account', async () => {
    const clock = fakeClock([
      { accountId: A, kind: 'expire' },
      { accountId: B, kind: 'remind' },
    ]);
    const { execute, ran } = inngestLike();
    const result = await execute(handlerOf(clock));
    expect(ran).toEqual([
      'now',
      'due',
      `expire-${A}`,
      `expire-effects-${A}`,
      `remind-${B}`,
      `remind-effects-${B}`,
    ]);
    expect(TRIAL_CLOCK_LIMIT).toBe(100);
    expect(clock.due).toHaveBeenCalledWith(new Date(NOW), 100);
    expect(clock.expire).toHaveBeenCalledWith(A, new Date(NOW));
    expect(clock.remind).toHaveBeenCalledWith(B, new Date(NOW));
    expect(clock.dispatch.mock.calls).toEqual([
      [[{ kind: 'send', id: `expire:${A}` }]],
      [[{ kind: 'send', id: `remind:${B}` }]],
    ]);
    expect(result).toEqual({ out: { handled: 2, applied: 2, ignored: 0 } });
  });

  it('after a failed reminder read, handles the expiries and then ends failed', async () => {
    const clock = fakeClock([], {
      due: async () => ({ due: [{ accountId: A, kind: 'expire' }], reminderReadFailed: true }),
    });
    const result = await inngestLike().execute(handlerOf(clock));
    expect(clock.expire).toHaveBeenCalledTimes(1);
    expect(clock.dispatch).toHaveBeenCalledTimes(1);
    expect((result as { error: Error }).error.message).toContain('reminders could not be read');
  });

  it('counts what the machine ignored as ignored', async () => {
    const clock = fakeClock([{ accountId: A, kind: 'expire' }], {
      expire: async () => ({ outcome: 'ignored', reason: 'not a no-card trial', planned: [] }),
    });
    expect(await inngestLike().execute(handlerOf(clock))).toEqual({
      out: { handled: 1, applied: 0, ignored: 1 },
    });
  });

  it('a failed send is retried with the recorded plan; the account is not applied again', async () => {
    const clock = fakeClock([{ accountId: A, kind: 'remind' }], {
      dispatch: vi
        .fn<TrialClockPorts['dispatch']>()
        .mockRejectedValueOnce(new Error('send failed'))
        .mockResolvedValue(undefined),
    });
    await inngestLike().execute(handlerOf(clock));
    expect(clock.remind).toHaveBeenCalledTimes(1);
    expect(clock.dispatch).toHaveBeenCalledTimes(2);
  });

  it('an account that keeps failing does not hold up the next, and the run ends failed naming it', async () => {
    const clock = fakeClock(
      [
        { accountId: A, kind: 'expire' },
        { accountId: B, kind: 'expire' },
      ],
      {
        expire: async (id) => {
          if (id === A) throw new Error('down');
          return applied(`expire:${id}`);
        },
      },
    );
    const result = await inngestLike().execute(handlerOf(clock));
    expect(clock.dispatch.mock.calls).toEqual([[[{ kind: 'send', id: `expire:${B}` }]]]);
    expect(result).toMatchObject({ error: expect.any(Error) });
    expect((result as { error: Error }).error.message).toContain(`1 of 2 accounts failed: ${A}`);
  });
});
