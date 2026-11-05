/**
 * Test support: a Browser Run client that replays reply fixtures, and an in-memory daily budget. Used
 * by the tests only; production passes a real client and CC-20's store.
 */
import { readdirSync, readFileSync } from 'node:fs';
import type { BrowserRunClient, RenderReply, RenderSide } from './client.js';
import type { DailyBudget } from './budget.js';

export interface ReplyFixture {
  provenance: string;
  url: string;
  static: { html: string; browser_ms: number };
  rendered: { html: string; browser_ms: number };
}

const FIXTURES = new URL('../../../fixtures/v2/render/replies/', import.meta.url);

export function replyFixtures(): Map<string, ReplyFixture> {
  return new Map(
    readdirSync(FIXTURES)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => {
        const fixture = JSON.parse(readFileSync(new URL(f, FIXTURES), 'utf8')) as ReplyFixture;
        return [f.replace(/\.json$/, ''), fixture] as const;
      }),
  );
}

export interface FakeClient extends BrowserRunClient {
  calls: { url: string; side: RenderSide }[];
  /** The most calls that were open at once. */
  maxInFlight: number;
}

/**
 * Replays `fixtures` by URL. `before` may answer a call itself (a 429, a failure) by returning a reply;
 * returning undefined replays the fixture. `delayMs` keeps each call open so concurrency is observable.
 */
export function fakeClient(
  fixtures: Iterable<ReplyFixture>,
  opts: {
    before?: (n: number, url: string, side: RenderSide) => RenderReply | undefined;
    delayMs?: number;
  } = {},
): FakeClient {
  const byUrl = new Map([...fixtures].map((f) => [f.url, f]));
  let open = 0;
  const fake: FakeClient = {
    calls: [],
    maxInFlight: 0,
    async content(url, side) {
      const n = fake.calls.push({ url, side });
      open += 1;
      fake.maxInFlight = Math.max(fake.maxInFlight, open);
      try {
        await new Promise((r) => setTimeout(r, opts.delayMs ?? 0));
        const forced = opts.before?.(n, url, side);
        if (forced) return forced;
        const f = byUrl.get(url);
        if (!f) return { ok: false, reason: 'page_failed', retryAfterMs: null, browserMs: 100 };
        return { ok: true, html: f[side].html, browserMs: f[side].browser_ms };
      } finally {
        open -= 1;
      }
    },
  };
  return fake;
}

export function memoryDailyBudget(limitMs: number): DailyBudget & { usedMs: () => number } {
  let used = 0;
  return {
    usedMs: () => used,
    async reserve(ms) {
      if (used + ms > limitMs) return false;
      used += ms;
      return true;
    },
    async settle(reservedMs, usedMs) {
      used += usedMs - reservedMs;
    },
  };
}
