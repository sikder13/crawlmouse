import { describe, expect, it } from 'vitest';
import { inngest } from './client';
import { CHECK_REAPER_FN_ID, createCheckReaperFn, type ReapedCheck } from './check-reaper';

function fakeStep() {
  const ids: string[] = [];
  const events: unknown[] = [];
  return {
    ids,
    events,
    step: {
      run: async (id: string, fn: () => Promise<unknown>) => {
        ids.push(id);
        return fn();
      },
      sendEvent: async (id: string, payload: unknown) => {
        ids.push(id);
        events.push(payload);
      },
    },
  };
}

async function reapWith(reaped: ReapedCheck[]) {
  const fn = createCheckReaperFn(async () => reaped) as unknown as {
    fn: (ctx: unknown) => Promise<unknown>;
  };
  const fake = fakeStep();
  const out = await fn.fn({ step: fake.step });
  return { out, ...fake };
}

describe('createCheckReaperFn (D13)', () => {
  it('runs every ten minutes, one run at a time', () => {
    const [config] = (
      createCheckReaperFn(async () => []) as unknown as {
        getConfig(o: { baseUrl: URL; appPrefix: string }): Record<string, unknown>[];
      }
    ).getConfig({ baseUrl: new URL('https://example.com/api/inngest'), appPrefix: inngest.id });
    expect(config).toMatchObject({
      id: `${inngest.id}-${CHECK_REAPER_FN_ID}`,
      triggers: [{ cron: '*/10 * * * *' }],
      concurrency: { limit: 1 },
    });
  });

  it('sends check.failed for each reaped check, with its reason', async () => {
    const { events, ids, out } = await reapWith([
      { checkId: 'c1', siteId: 's1', reason: 'stalled' },
      { checkId: 'c2', siteId: 's2', reason: 'not_started' },
    ]);
    expect(ids).toEqual(['reap', 'emit-failed']);
    expect(events).toEqual([
      [
        { name: 'check.failed', data: { checkId: 'c1', siteId: 's1', reason: 'stalled' } },
        { name: 'check.failed', data: { checkId: 'c2', siteId: 's2', reason: 'not_started' } },
      ],
    ]);
    expect(out).toEqual({ reaped: 2 });
  });

  it('sends nothing when nothing was reaped', async () => {
    const { events, ids } = await reapWith([]);
    expect(ids).toEqual(['reap']);
    expect(events).toEqual([]);
  });
});
