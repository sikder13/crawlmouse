import { describe, expect, it } from 'vitest';
import { STEP_OUTPUT_BYTES } from './check';
import { inngest } from './client';
import { CHECK_EXPIRY_FN_ID, createExpireAnonymousChecksFn, type ExpiryWork } from './check-expiry';

const EXPIRED = { sites: 3, checks: 3, skipped: 1, left: 7 };
const SETTLED = { moved: 2, nothing: 1, failed: 0, left: 0 };
const PURGED = { sites: 1, checks: 4, skipped: 0, left: 2 };

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
        purgeRemoved: async () => PURGED,
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

  it('expires in one step, settles in the next, purges removed sites in the third, and returns each step’s counts', async () => {
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
      purgeRemoved: async () => {
        order.push('purge');
        return PURGED;
      },
    });
    expect(ids).toEqual(['expire-unkept', 'settle-kept', 'purge-removed']);
    expect(order).toEqual(['expire', 'settle', 'purge']);
    expect(out).toEqual({ expired: EXPIRED, settled: SETTLED, purged: PURGED });
    expect(Buffer.byteLength(JSON.stringify(out))).toBeLessThan(STEP_OUTPUT_BYTES);
  });

  it('a failed purge step fails the run after the other two have run', async () => {
    const order: string[] = [];
    await expect(
      runWith({
        expireUnkept: async () => {
          order.push('expire');
          return EXPIRED;
        },
        settleKept: async () => {
          order.push('settle');
          return SETTLED;
        },
        purgeRemoved: async () => {
          throw new Error('function removed_sites_past_keeping does not exist');
        },
      }),
    ).rejects.toThrow('removed_sites_past_keeping');
    expect(order).toEqual(['expire', 'settle']);
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
        purgeRemoved: async () => {
          order.push('purge');
          return PURGED;
        },
      }),
    ).rejects.toThrow('database unavailable');
    expect(order).toEqual([]);
  });
});
