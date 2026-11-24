import { describe, expect, it } from 'vitest';
import { inngest } from './client';
import { PLAN_CONCURRENCY_CAP } from './concurrency';
import {
  LOOK_POLLS_S,
  LOOK_AGAIN_MS,
  SENTINEL_TICK_FN_ID,
  SENTINEL_WATCH_FN_ID,
  createSentinelTickFn,
  createSentinelWatchFn,
  type SentinelSteps,
} from './sentinel';

const SITE = 'c0000000-0000-4000-8000-000000000001';
const NOW = Date.parse('2026-11-24T06:23:00Z');

const config = (fn: unknown) =>
  (
    fn as { getConfig(o: { baseUrl: URL; appPrefix: string }): Record<string, unknown>[] }
  ).getConfig({ baseUrl: new URL('https://example.com/api/inngest'), appPrefix: inngest.id })[0]!;

const work = (over: Partial<SentinelSteps> = {}): SentinelSteps => ({
  due: async () => ({ siteIds: [SITE, 'c0000000-0000-4000-8000-000000000002'] }),
  plan: async () => ({
    host: 'h.example',
    baseline: 'full-1',
    pages: [{ template_key: '/', url: 'https://h.example/' }],
  }),
  look: async (_s, _h, _p, n) => ({ batchId: `look-${n}:0` }),
  result: async () => ({ status: 'done', moved: 0 }),
  request: async () => ({ checkId: 'check-1' }),
  ...over,
});

function tools(ids: string[], sent: unknown[] = []) {
  return {
    run: async (id: string, body: () => Promise<unknown>) => {
      ids.push(id);
      return body();
    },
    sleep: async (id: string) => {
      ids.push(id);
    },
    sendEvent: async (id: string, events: unknown) => {
      ids.push(id);
      sent.push(events);
    },
  };
}

async function watch(w: SentinelSteps) {
  const ids: string[] = [];
  const fn = createSentinelWatchFn(w, {}) as unknown as { fn: (ctx: unknown) => Promise<unknown> };
  const out = await fn.fn({
    event: { data: { siteId: SITE, day: '2026-11-24' } },
    step: tools(ids),
  });
  return { out, ids };
}

describe('createSentinelTickFn (row 23)', () => {
  it('runs hourly', () => {
    expect(config(createSentinelTickFn(work(), {}))).toMatchObject({
      id: `${inngest.id}-${SENTINEL_TICK_FN_ID}`,
      triggers: [{ cron: '23 * * * *' }],
    });
  });

  it('asks for the sites due this UTC hour and sends one watch per site, deduplicated per day', async () => {
    const ids: string[] = [];
    const sent: unknown[] = [];
    const hours: number[] = [];
    const fn = createSentinelTickFn(
      work({ due: async (h) => (hours.push(h), { siteIds: [SITE] }) }),
      {},
      () => NOW,
    ) as unknown as { fn: (ctx: unknown) => Promise<unknown> };
    const out = await fn.fn({ event: {}, step: tools(ids, sent) });
    expect(hours).toEqual([6]);
    expect(ids).toEqual(['due', 'watch']);
    expect(sent).toEqual([
      [
        {
          id: `sentinel-watch:${SITE}:2026-11-24`,
          name: 'sentinel.watch',
          data: { siteId: SITE, day: '2026-11-24' },
        },
      ],
    ]);
    expect(out).toEqual({ watched: 1 });
  });

  it('sends nothing when nothing is due', async () => {
    const ids: string[] = [];
    const fn = createSentinelTickFn(
      work({ due: async () => ({ skip: 'hidden' }) }),
      {},
      () => NOW,
    ) as unknown as {
      fn: (ctx: unknown) => Promise<unknown>;
    };
    expect(await fn.fn({ event: {}, step: tools(ids) })).toEqual({ skip: 'hidden' });
    expect(ids).toEqual(['due']);
  });
});

describe('createSentinelWatchFn (row 23)', () => {
  it('runs on sentinel.watch within the plan cap', () => {
    expect(
      config(createSentinelWatchFn(work(), { INNGEST_SENTINEL_CONCURRENCY: '900' })),
    ).toMatchObject({
      id: `${inngest.id}-${SENTINEL_WATCH_FN_ID}`,
      triggers: [{ event: 'sentinel.watch' }],
      concurrency: { limit: PLAN_CONCURRENCY_CAP },
    });
  });

  it('looks once, and stops when nothing moved', async () => {
    const { out, ids } = await watch(work());
    expect(ids).toEqual(['plan', 'look-1', 'wait-1-1', 'result-1-1']);
    expect(out).toEqual({ moved: 0 });
  });

  it('treats a move seen once as noise', async () => {
    let n = 0;
    const { out, ids } = await watch(
      work({ result: async () => ({ status: 'done', moved: ++n === 1 ? 2 : 0 }) }),
    );
    expect(ids).toEqual([
      'plan',
      'look-1',
      'wait-1-1',
      'result-1-1',
      'again',
      'look-2',
      'wait-2-1',
      'result-2-1',
    ]);
    expect(out).toEqual({ moved: 0, seenOnce: 2 });
  });

  it('starts a full check when it moved twice, five minutes apart', async () => {
    const slept: number[] = [];
    const ids: string[] = [];
    const fn = createSentinelWatchFn(
      work({ result: async () => ({ status: 'done', moved: 1 }) }),
      {},
    ) as unknown as {
      fn: (ctx: unknown) => Promise<unknown>;
    };
    const t = tools(ids);
    const out = await fn.fn({
      event: { data: { siteId: SITE, day: '2026-11-24' } },
      step: { ...t, sleep: async (id: string, ms: number) => (ids.push(id), slept.push(ms)) },
    });
    expect(ids.at(-1)).toBe('request');
    expect(slept).toContain(LOOK_AGAIN_MS);
    expect(LOOK_AGAIN_MS).toBe(5 * 60 * 1000);
    expect(out).toEqual({ moved: 1, checkId: 'check-1' });
  });

  it('polls a running look until its last poll, then gives up without starting anything', async () => {
    const { out, ids } = await watch(work({ result: async () => ({ status: 'running' }) }));
    expect(ids.filter((i) => i.startsWith('result-1-'))).toHaveLength(LOOK_POLLS_S.length);
    expect(ids).not.toContain('request');
    expect(out).toEqual({ skip: 'look_unread' });
  });

  it('starts nothing on a look that failed', async () => {
    const { out, ids } = await watch(work({ result: async () => ({ status: 'failed' }) }));
    expect(ids).not.toContain('request');
    expect(out).toEqual({ skip: 'look_unread' });
  });

  it('stops after the plan for a site with no baseline', async () => {
    const { out, ids } = await watch(work({ plan: async () => ({ skip: 'no_baseline' }) }));
    expect(ids).toEqual(['plan']);
    expect(out).toEqual({ skip: 'no_baseline' });
  });
});
