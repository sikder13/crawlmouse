import { describe, expect, it } from 'vitest';
import { STEP_OUTPUT_BYTES } from './check';
import { inngest } from './client';
import { CHECK_EXPIRY_FN_ID, createExpireAnonymousChecksFn, type ExpiryWork } from './check-expiry';

const EXPIRED = { sites: 3, checks: 3, skipped: 1, left: 7 };
const SETTLED = { moved: 2, nothing: 1, failed: 0, left: 0 };

async function runWith(work: ExpiryWork) {
  const ids: string[] = [];
  const fn = createExpireAnonymousChecksFn(work) as unknown as {
    fn: (ctx: unknown) => Promise<unknown>;
  };
  const out = await fn.fn({
    step: {
      run: async (id: string, body: () => Promise<unknown>) => {
        ids.push(id);
        return body();
      },
    },
  });
  return { out, ids };
}

describe('createExpireAnonymousChecksFn (CC-22b D8)', () => {
  it('runs once a day at 05:17 UTC, one run at a time', () => {
    const [config] = (
      createExpireAnonymousChecksFn({
        expireUnkept: async () => EXPIRED,
        settleKept: async () => SETTLED,
      }) as unknown as {
        getConfig(o: { baseUrl: URL; appPrefix: string }): Record<string, unknown>[];
      }
    ).getConfig({ baseUrl: new URL('https://example.com/api/inngest'), appPrefix: inngest.id });
    expect(config).toMatchObject({
      id: `${inngest.id}-${CHECK_EXPIRY_FN_ID}`,
      triggers: [{ cron: '17 5 * * *' }],
      concurrency: { limit: 1 },
    });
    expect(CHECK_EXPIRY_FN_ID).toBe('crawlmouse.check.expiry');
  });

  it('expires in one step and settles in the next, and returns both steps’ counts', async () => {
    const order: string[] = [];
    const { out, ids } = await runWith({
      expireUnkept: async () => {
        order.push('expire');
        return EXPIRED;
      },
      settleKept: async () => {
        order.push('settle');
        return SETTLED;
      },
    });
    expect(ids).toEqual(['expire-unkept', 'settle-kept']);
    expect(order).toEqual(['expire', 'settle']);
    expect(out).toEqual({ expired: EXPIRED, settled: SETTLED });
    expect(Buffer.byteLength(JSON.stringify(out))).toBeLessThan(STEP_OUTPUT_BYTES);
  });

  it('a failed expire step fails the run before the settle step starts', async () => {
    const order: string[] = [];
    await expect(
      runWith({
        expireUnkept: async () => {
          throw new Error('database unavailable');
        },
        settleKept: async () => {
          order.push('settle');
          return SETTLED;
        },
      }),
    ).rejects.toThrow('database unavailable');
    expect(order).toEqual([]);
  });
});
