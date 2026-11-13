import { describe, expect, it, vi } from 'vitest';
import { inngest } from './client';
import {
  CANARY_WAIT,
  createSigninCanaryFn,
  SIGNIN_CANARY_FN_ID,
  type CanaryWork,
} from './signin-canary';

const config = (fn: unknown) =>
  (
    fn as { getConfig(o: { baseUrl: URL; appPrefix: string }): Record<string, unknown>[] }
  ).getConfig({ baseUrl: new URL('https://example.com/api/inngest'), appPrefix: inngest.id })[0]!;

const REQUESTED_AT = '2026-11-13T12:00:00.000Z';

/**
 * A step tool that behaves as Inngest's does across invocations: a step that returned is recorded
 * (through JSON) and not run again, and a sleep is recorded once. A step that throws stands for one
 * that has used its retries: the handler gets the error, as Inngest's `StepError`, and a replay gets
 * the same error without running the step again.
 */
function memoStep() {
  const memo = new Map<string, { out: unknown } | { error: unknown }>();
  const ran: string[] = [];
  const slept: { id: string; duration: string }[] = [];
  const step = {
    run: async (id: string, fn: () => unknown) => {
      const seen = memo.get(id);
      if (seen && 'error' in seen) throw seen.error;
      if (seen) return seen.out;
      ran.push(id);
      try {
        const out = JSON.parse(JSON.stringify((await fn()) ?? null)) as unknown;
        memo.set(id, { out });
        return out;
      } catch (error) {
        memo.set(id, { error });
        throw error;
      }
    },
    sleep: async (id: string, duration: string) => {
      if (memo.has(id)) return;
      slept.push({ id, duration });
      memo.set(id, { out: null });
    },
  };
  return { step, ran, slept };
}

function work(over: Partial<CanaryWork> = {}) {
  return {
    now: vi.fn<CanaryWork['now']>(over.now ?? (() => new Date(REQUESTED_AT))),
    request: vi.fn<CanaryWork['request']>(over.request ?? (async () => 'sent')),
    delivered: vi.fn<CanaryWork['delivered']>(over.delivered ?? (async () => true)),
    report: vi.fn<CanaryWork['report']>(over.report ?? (async () => undefined)),
  };
}

async function run(w: ReturnType<typeof work>) {
  const fn = createSigninCanaryFn(() => w) as unknown as {
    fn: (ctx: unknown) => Promise<unknown>;
  };
  const s = memoStep();
  const out = await fn.fn({ step: s.step });
  // A second invocation of the same run, as Inngest replays it: no step runs again.
  const again = await fn.fn({ step: s.step });
  return { out, again, ...s };
}

describe('the sign-in canary (D6)', () => {
  it('runs every ten minutes, one at a time', () => {
    expect(config(createSigninCanaryFn(() => work()))).toMatchObject({
      id: `${inngest.id}-${SIGNIN_CANARY_FN_ID}`,
      triggers: [{ cron: '*/10 * * * *' }],
      concurrency: { limit: 1 },
    });
  });

  it('asks for a link, waits five minutes, and looks for a delivery since the request', async () => {
    const w = work();
    const { out, again, ran, slept } = await run(w);
    expect(ran).toEqual(['request', 'look']);
    expect(slept).toEqual([{ id: 'wait', duration: CANARY_WAIT }]);
    expect(CANARY_WAIT).toBe('5m');
    expect(w.request).toHaveBeenCalledTimes(1);
    expect(w.delivered).toHaveBeenCalledWith(REQUESTED_AT);
    expect(w.report).not.toHaveBeenCalled();
    expect(out).toEqual({ requested: 'sent', delivered: true });
    expect(again).toEqual(out);
  });

  it('takes the request time before it asks, so a delivery during the request counts', async () => {
    const order: string[] = [];
    const w = work({
      now: () => {
        order.push('now');
        return new Date(REQUESTED_AT);
      },
      request: async () => {
        order.push('request');
        return 'sent';
      },
    });
    await run(w);
    expect(order).toEqual(['now', 'request']);
  });

  it('raises the signal once when nothing was delivered', async () => {
    const w = work({ delivered: async () => false });
    const { out } = await run(w);
    expect(w.report).toHaveBeenCalledTimes(1);
    expect(w.report).toHaveBeenCalledWith('delivery');
    expect(out).toEqual({ requested: 'sent', delivered: false });
  });

  it('raises the signal at once, without waiting, when the request is refused', async () => {
    const w = work({ request: async () => 'refused' });
    const { out, ran, slept } = await run(w);
    expect(ran).toEqual(['request']);
    expect(slept).toEqual([]);
    expect(w.delivered).not.toHaveBeenCalled();
    expect(w.report).toHaveBeenCalledTimes(1);
    expect(w.report).toHaveBeenCalledWith('request');
    expect(out).toEqual({ requested: 'refused', delivered: null });
  });
});

describe('the sign-in canary when it fails itself (D6)', () => {
  async function failing(w: ReturnType<typeof work>) {
    const fn = createSigninCanaryFn(() => w) as unknown as {
      fn: (ctx: unknown) => Promise<unknown>;
    };
    const s = memoStep();
    const first = await fn.fn({ step: s.step }).then(
      () => null,
      (e: unknown) => e,
    );
    // Inngest replays the run once more; the failed step and the report are not run again.
    const again = await fn.fn({ step: s.step }).then(
      () => null,
      (e: unknown) => e,
    );
    return { first, again, ...s };
  }

  it('raises the signal, staged request_error, when asking for the link throws', async () => {
    const boom = new Error('auth unreachable');
    const w = work({
      request: async () => {
        throw boom;
      },
    });
    const { first, again, ran } = await failing(w);
    expect(first).toBe(boom);
    expect(again).toBe(boom);
    expect(ran).toEqual(['request', 'report-request_error']);
    expect(w.report).toHaveBeenCalledTimes(1);
    expect(w.report).toHaveBeenCalledWith('request_error');
    expect(w.delivered).not.toHaveBeenCalled();
  });

  it('raises the signal, staged look_error, when looking for the delivery throws', async () => {
    const boom = new Error('signin_delivery_seen: 42883');
    const w = work({
      delivered: async () => {
        throw boom;
      },
    });
    const { first, again, ran } = await failing(w);
    expect(first).toBe(boom);
    expect(again).toBe(boom);
    expect(ran).toEqual(['request', 'look', 'report-look_error']);
    expect(w.report).toHaveBeenCalledTimes(1);
    expect(w.report).toHaveBeenCalledWith('look_error');
  });

  it('still fails the run when its own report throws', async () => {
    const w = work({
      delivered: async () => {
        throw new Error('look');
      },
      report: async () => {
        throw new Error('sentry down');
      },
    });
    const { first } = await failing(w);
    expect(first).toEqual(new Error('sentry down'));
  });
});
