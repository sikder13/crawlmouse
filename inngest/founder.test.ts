import { describe, expect, it, vi } from 'vitest';
import { inngest } from './client';
import {
  createFounderDigestFn,
  createFounderEntitlementFn,
  createFounderSweepFn,
  FOUNDER_DIGEST_FN_ID,
  FOUNDER_ENTITLEMENT_FN_ID,
  FOUNDER_RETRIES,
  FOUNDER_SWEEP_FN_ID,
  type FounderWork,
} from './founder';

const config = (fn: unknown) =>
  (
    fn as { getConfig(o: { baseUrl: URL; appPrefix: string }): Record<string, unknown>[] }
  ).getConfig({ baseUrl: new URL('https://example.com/api/inngest'), appPrefix: inngest.id })[0]!;

const ACCOUNT = 'a0000000-0000-4000-8000-000000000001';

function work(): { [K in keyof FounderWork]: ReturnType<typeof vi.fn> } {
  return {
    entitlement: vi.fn(async () => 'sent'),
    sweep: vi.fn(async () => ({ signups: {} })),
    digest: vi.fn(async (_at: string) => ({ daily: 'not_due' })),
  };
}

const step = {
  run: async (_id: string, fn: () => unknown) => fn(),
};

const run = (fn: unknown, ctx: Record<string, unknown>) =>
  (fn as { fn: (c: unknown) => Promise<unknown> }).fn({ step, ...ctx });

describe('the founder functions (D3)', () => {
  it('are triggered as planned, one run at a time, with the summary’s retries', () => {
    const w = () => work() as unknown as FounderWork;
    expect(config(createFounderEntitlementFn(w))).toMatchObject({
      id: `${inngest.id}-${FOUNDER_ENTITLEMENT_FN_ID}`,
      triggers: [{ event: 'entitlement.changed' }],
      concurrency: { limit: 1 },
    });
    expect(config(createFounderSweepFn(w))).toMatchObject({
      id: `${inngest.id}-${FOUNDER_SWEEP_FN_ID}`,
      triggers: [{ cron: '*/5 * * * *' }],
      concurrency: { limit: 1 },
    });
    expect(config(createFounderDigestFn(w))).toMatchObject({
      id: `${inngest.id}-${FOUNDER_DIGEST_FN_ID}`,
      triggers: [{ cron: '7 * * * *' }],
      concurrency: { limit: 1 },
    });
    for (const fn of [createFounderEntitlementFn, createFounderSweepFn, createFounderDigestFn]) {
      const steps = config(fn(w)).steps as Record<string, { retries: { attempts: number } }>;
      expect(Object.values(steps)[0]!.retries.attempts).toBe(FOUNDER_RETRIES);
    }
  });

  it('retries a step 4 times, 5 runs in all, as the spec states (review T4)', () => {
    expect(FOUNDER_RETRIES).toBe(4);
    const steps = config(createFounderEntitlementFn(() => work() as unknown as FounderWork))
      .steps as Record<string, { retries: { attempts: number } }>;
    expect(Object.values(steps)[0]!.retries.attempts).toBe(4);
  });

  it('passes the event’s own id, its data and its time to the notice', async () => {
    const w = work();
    const id = `entitlement.changed:${ACCOUNT}:evt_1`;
    const out = await run(
      createFounderEntitlementFn(() => w as unknown as FounderWork),
      {
        event: {
          id,
          name: 'entitlement.changed',
          ts: Date.parse('2026-11-13T12:00:00.000Z'),
          data: { accountId: ACCOUNT, from: 'free', to: 'pro_trial' },
        },
      },
    );
    expect(w.entitlement).toHaveBeenCalledWith({
      id,
      accountId: ACCOUNT,
      from: 'free',
      to: 'pro_trial',
      occurredAt: '2026-11-13T12:00:00.000Z',
    });
    expect(out).toBe('sent');
  });

  it('lets the notice’s throw out of its step, so Inngest retries the step and then fails the run (review N3)', async () => {
    const w = work();
    w.entitlement.mockRejectedValueOnce(new Error('stripe unread'));
    await expect(
      run(
        createFounderEntitlementFn(() => w as unknown as FounderWork),
        {
          event: {
            id: `entitlement.changed:${ACCOUNT}:evt_1`,
            name: 'entitlement.changed',
            ts: 0,
            data: { accountId: ACCOUNT, from: 'past_due', to: 'pro' },
          },
        },
      ),
    ).rejects.toThrow('stripe unread');
  });

  it('passes a missing id on as missing, for the notice to refuse', async () => {
    const w = work();
    await run(
      createFounderEntitlementFn(() => w as unknown as FounderWork),
      {
        event: {
          name: 'entitlement.changed',
          ts: 0,
          data: { accountId: ACCOUNT, from: 'free', to: 'pro_trial' },
        },
      },
    );
    expect(w.entitlement.mock.calls[0]![0]).toMatchObject({ id: undefined });
  });

  it('takes the digest tick’s time once, in its own step, so a retry an hour on keeps the hour’s keys (review C6)', async () => {
    vi.useFakeTimers();
    try {
      // Inngest memoizes a step's answer: a retry runs the function again and is handed the answers
      // of the steps that finished, here the clock's.
      const done = new Map<string, unknown>();
      const memo = {
        run: async (id: string, fn: () => unknown) => {
          if (!done.has(id)) done.set(id, await fn());
          return done.get(id);
        },
      };
      const w = work();
      w.digest.mockRejectedValueOnce(new Error('transport down'));
      const fn = createFounderDigestFn(() => w as unknown as FounderWork) as unknown as {
        fn: (c: unknown) => Promise<unknown>;
      };
      vi.setSystemTime(new Date('2026-11-13T15:59:30.000Z'));
      await expect(fn.fn({ step: memo })).rejects.toThrow('transport down');
      vi.setSystemTime(new Date('2026-11-13T16:04:00.000Z'));
      await fn.fn({ step: memo });
      expect(w.digest.mock.calls).toEqual([
        ['2026-11-13T15:59:30.000Z'],
        ['2026-11-13T15:59:30.000Z'],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs the sweep in one step and the digest after its clock step, and returns their outcome', async () => {
    const w = work();
    expect(
      await run(
        createFounderSweepFn(() => w as unknown as FounderWork),
        {},
      ),
    ).toEqual({
      signups: {},
    });
    expect(
      await run(
        createFounderDigestFn(() => w as unknown as FounderWork),
        {},
      ),
    ).toEqual({
      daily: 'not_due',
    });
  });
});
