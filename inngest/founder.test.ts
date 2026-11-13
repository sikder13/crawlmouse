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
    digest: vi.fn(async () => ({ daily: 'not_due' })),
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

  it('runs the sweep and the digest in one step each, and returns their outcome', async () => {
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
