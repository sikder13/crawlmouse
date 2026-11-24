import { describe, expect, it } from 'vitest';
import { inngest } from './client';
import { PLAN_CONCURRENCY_CAP } from './concurrency';
import {
  LOOK_AGAIN_MS,
  LOOK_POLLS_S,
  SENTINEL_TICK_FN_ID,
  SENTINEL_WATCH_FN_ID,
  SPREAD_MS,
  createSentinelTickFn,
  createSentinelWatchFn,
  spreadMs,
  type SentinelSteps,
} from './sentinel';

const SITE = 'c0000000-0000-4000-8000-000000000001';
const DAY = '2026-11-24';
const NOW = Date.parse('2026-11-24T06:23:00Z');

const config = (fn: unknown) =>
  (
    fn as { getConfig(o: { baseUrl: URL; appPrefix: string }): Record<string, unknown>[] }
  ).getConfig({ baseUrl: new URL('https://example.com/api/inngest'), appPrefix: inngest.id })[0]!;

const work = (over: Partial<SentinelSteps> = {}): SentinelSteps => ({
  dispatch: async () => ({ watched: 2 }),
  look: async (_s, _d, n) => ({ batchId: `look-${n}:0`, baseline: 'full-1' }),
  result: async () => ({ status: 'done', moved: 0 }),
  request: async () => ({ checkId: 'check-1' }),
  ...over,
});

type Fn = { fn: (ctx: unknown) => Promise<unknown> };

function tools(ids: string[], slept: number[] = []) {
  return {
    run: async (id: string, body: () => Promise<unknown>) => {
      ids.push(id);
      return body();
    },
    sleep: async (id: string, ms: number) => {
      ids.push(id);
      slept.push(ms);
    },
  };
}

async function watch(w: SentinelSteps) {
  const ids: string[] = [];
  const slept: number[] = [];
  const fn = createSentinelWatchFn(w, {}) as unknown as Fn;
  const out = await fn.fn({ event: { data: { siteId: SITE, day: DAY } }, step: tools(ids, slept) });
  return { out, ids, slept };
}

describe('createSentinelTickFn (row 23)', () => {
  it('runs hourly', () => {
    expect(config(createSentinelTickFn(work()))).toMatchObject({
      id: `${inngest.id}-${SENTINEL_TICK_FN_ID}`,
      triggers: [{ cron: '23 * * * *' }],
    });
  });

  it("dispatches this UTC hour's sites in its one step, and answers a count", async () => {
    const ids: string[] = [];
    const asked: [number, string][] = [];
    const fn = createSentinelTickFn(
      work({ dispatch: async (h, d) => (asked.push([h, d]), { watched: 1 }) }),
      () => NOW,
    ) as unknown as Fn;
    expect(await fn.fn({ event: {}, step: tools(ids) })).toEqual({ watched: 1 });
    expect(asked).toEqual([[6, DAY]]);
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

  it('waits its place in the hour, looks once, and stops when nothing moved', async () => {
    const { out, ids, slept } = await watch(work());
    expect(ids).toEqual(['spread', 'look-1', 'wait-1-1', 'result-1-1']);
    expect(slept[0]).toBe(spreadMs(SITE));
    expect(out).toEqual({ moved: 0 });
  });

  it('spreads sites over the first fifty minutes of the hour, the same for a site every day', () => {
    const offsets = Array.from({ length: 500 }, (_, i) =>
      spreadMs(`c0000000-0000-4000-8000-${String(i).padStart(12, '0')}`),
    );
    expect(offsets.every((o) => o >= 0 && o < SPREAD_MS)).toBe(true);
    expect(SPREAD_MS).toBe(50 * 60 * 1000);
    expect(Math.max(...offsets) - Math.min(...offsets)).toBeGreaterThan(SPREAD_MS / 2);
    expect(spreadMs(SITE)).toBe(spreadMs(SITE));
  });

  it("passes the event's day to each look and to the request, and the look's baseline to its read", async () => {
    const looks: unknown[] = [];
    const reads: unknown[] = [];
    const requests: unknown[] = [];
    await watch(
      work({
        look: async (...a) => (looks.push(a), { batchId: 'b:0', baseline: 'full-7' }),
        result: async (...a) => (reads.push(a), { status: 'done', moved: 1 }),
        request: async (...a) => (requests.push(a), { checkId: 'c' }),
      }),
    );
    expect(looks).toEqual([
      [SITE, DAY, 1],
      [SITE, DAY, 2],
    ]);
    expect(reads).toEqual([
      ['full-7', 'b:0'],
      ['full-7', 'b:0'],
    ]);
    expect(requests).toEqual([[SITE, DAY]]);
  });

  it('treats a move seen once as noise', async () => {
    let n = 0;
    const { out, ids } = await watch(
      work({ result: async () => ({ status: 'done', moved: ++n === 1 ? 2 : 0 }) }),
    );
    expect(ids).toEqual([
      'spread',
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
    const { out, ids, slept } = await watch(
      work({ result: async () => ({ status: 'done', moved: 1 }) }),
    );
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

  it('starts nothing on a look that failed or was skipped', async () => {
    for (const w of [
      work({ result: async () => ({ status: 'failed' }) }),
      work({ look: async () => ({ skip: 'worker_busy' }) }),
    ]) {
      const { out, ids } = await watch(w);
      expect(ids).not.toContain('request');
      expect(out).toEqual({ skip: 'look_unread' });
    }
  });
});
