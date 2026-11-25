/**
 * Row 17's full render, the orchestration: chunks under one browser-time budget, a wall-time bound,
 * the merge, and the done event the check waits on. The step bodies are fakes that report the browser
 * time each chunk counted.
 */
import { describe, expect, it } from 'vitest';
import {
  FULL_RENDER_CHUNK_PAGES,
  FULL_RENDER_MAX_BROWSER_MS,
  FULL_RENDER_PAGE_RESERVE_MS,
} from '@crawlmouse/engine/v2/pipeline';
import type { CheckRequested } from './check-events';
import {
  FULL_RENDER_STEP_S,
  FULL_RENDER_WALL_S,
  runFullRender,
  type FullRenderSteps,
  type NotReached,
} from './full-render';

const EVENT: CheckRequested = {
  checkId: '11111111-1111-4111-8111-111111111111',
  siteId: '22222222-2222-4222-8222-222222222222',
  accountId: '33333333-3333-4333-8333-333333333333',
  host: 'example.com',
  homepageUrl: 'https://example.com/',
  trigger: 'manual',
  pageCap: 2000,
};
const T0 = Date.UTC(2026, 10, 25, 4, 0, 0);

/** Fake steps: `pages` to render; each chunk counts `msPerChunk` and takes `sPerChunk` of wall time. */
function drive(pages: number, msPerChunk: number, sPerChunk = 60, maxBrowserMs?: number) {
  const ids: string[] = [];
  const events: unknown[] = [];
  const asked: { index: number; leftMs: number; deadlineAt: number }[] = [];
  let merged: NotReached | null = null;
  let now = T0;
  const steps: FullRenderSteps = {
    plan: async () => ({ pages, at: now }),
    chunk: async (_e, index, leftMs, deadlineAt) => {
      asked.push({ index, leftMs, deadlineAt });
      now += sPerChunk * 1000;
      return { browser_ms: msPerChunk, at: now };
    },
    merge: async (_e, notReached) => {
      merged = notReached;
      return { merged: true };
    },
  };
  const run = runFullRender(
    {
      event: { data: EVENT },
      step: {
        run: async (id, fn) => {
          ids.push(id);
          return fn();
        },
        sendEvent: async (id, payload) => {
          ids.push(id);
          events.push(payload);
        },
      },
    },
    steps,
    maxBrowserMs,
  );
  return { run, ids, events, asked, merged: () => merged };
}

describe('the full render’s orchestration (row 17)', () => {
  it('renders every chunk when the budget and the time hold, then merges and tells the check', async () => {
    const d = drive(60, 100_000);
    const out = await d.run;
    expect(d.ids).toEqual(['plan', 'chunk-0', 'chunk-1', 'chunk-2', 'merge', 'done']);
    expect(out).toEqual({ merged: true, chunks: 3, spent_ms: 300_000, stopped: null });
    expect(d.events).toEqual([
      {
        id: `check-render-full-done:${EVENT.checkId}`,
        name: 'check.render-full.done',
        data: { checkId: EVENT.checkId, merged: true },
      },
    ]);
  });

  it('gives each chunk what the budget has left, and a deadline a step long', async () => {
    const d = drive(60, 1_000_000);
    await d.run;
    expect(d.asked.map((a) => a.leftMs)).toEqual([
      FULL_RENDER_MAX_BROWSER_MS,
      FULL_RENDER_MAX_BROWSER_MS - 1_000_000,
      FULL_RENDER_MAX_BROWSER_MS - 2_000_000,
    ]);
    expect(d.asked[0]!.deadlineAt).toBe(T0 + FULL_RENDER_STEP_S * 1000);
  });

  // The hard bound (inbox 100): whatever a request costs, a full render stops at its budget.
  it('stops at FULL_RENDER_MAX_BROWSER_MS: no chunk starts once a page’s two renders cannot fit', async () => {
    const perChunk = 5_000_000;
    const d = drive(2000, perChunk);
    const out = await d.run;
    // 13,600,000 ms: chunks start with 13,600,000, 8,600,000 and 3,600,000 left (each holds a page's
    // 90,000 ms); after the third, 15,000,000 is spent and none can start.
    expect(out.chunks).toBe(3);
    expect(d.asked.map((a) => a.leftMs)).toEqual([13_600_000, 8_600_000, 3_600_000]);
    expect(out.stopped).toBe('check_cap');
    expect(d.merged()).toBe('check_cap');
    expect(Math.max(...d.asked.map((a) => a.leftMs))).toBe(FULL_RENDER_MAX_BROWSER_MS);
    for (const a of d.asked) expect(a.leftMs).toBeGreaterThanOrEqual(FULL_RENDER_PAGE_RESERVE_MS);
  });

  it('never asks a chunk to render with less than a page’s reservation left', async () => {
    const budget = 3 * FULL_RENDER_PAGE_RESERVE_MS;
    const d = drive(2000, FULL_RENDER_PAGE_RESERVE_MS, 60, budget);
    const out = await d.run;
    expect(out.chunks).toBe(3);
    expect(d.asked.at(-1)!.leftMs).toBe(FULL_RENDER_PAGE_RESERVE_MS);
  });

  it('stops for time: no chunk starts with less than a step’s time left of the wall', async () => {
    const d = drive(2000, 1_000, 600);
    const out = await d.run;
    expect(out.stopped).toBe('out_of_time');
    expect(d.merged()).toBe('out_of_time');
    // 1,800 s of wall at 600 s a chunk: chunks start at 0, 600 and 1,200 s; at 1,800 none can.
    expect(out.chunks).toBe(Math.floor((FULL_RENDER_WALL_S - FULL_RENDER_STEP_S) / 600) + 1);
    expect(d.ids.at(-1)).toBe('done');
  });

  it('plans in chunks of FULL_RENDER_CHUNK_PAGES', async () => {
    const d = drive(FULL_RENDER_CHUNK_PAGES * 2 + 1, 1_000);
    expect((await d.run).chunks).toBe(3);
  });
});
