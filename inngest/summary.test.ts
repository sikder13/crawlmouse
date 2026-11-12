import { describe, expect, it } from 'vitest';
import { inngest } from './client';
import {
  createSummarySendFn,
  createSummaryTickFn,
  SUMMARY_PAGE,
  SUMMARY_SEND_FN_ID,
  SUMMARY_TICK_FN_ID,
  type SummaryRequested,
} from './summary';

const config = (fn: unknown) =>
  (
    fn as { getConfig(o: { baseUrl: URL; appPrefix: string }): Record<string, unknown>[] }
  ).getConfig({ baseUrl: new URL('https://example.com/api/inngest'), appPrefix: inngest.id })[0]!;

const due = (n: number): SummaryRequested[] =>
  Array.from({ length: n }, (_, k) => ({
    accountId: `a0000000-0000-4000-8000-${String(k).padStart(12, '0')}`,
    weekKey: '2026-W47',
    weekStart: '2026-11-16T05:00:00.000Z',
  }));

async function tick(all: SummaryRequested[]) {
  const ids: string[] = [];
  const sent: { id: string; events: unknown[] }[] = [];
  const asked: [string, number, number][] = [];
  const fn = createSummaryTickFn({
    due: async (now, offset, limit) => {
      asked.push([now, offset, limit]);
      return all.filter((_, k) => k >= offset && k < offset + limit);
    },
  }) as unknown as { fn: (ctx: unknown) => Promise<unknown> };
  const out = await fn.fn({
    step: {
      run: async (id: string, body: () => Promise<unknown>) => {
        ids.push(id);
        return body();
      },
      sendEvent: async (id: string, events: unknown[]) => {
        sent.push({ id, events });
      },
    },
  });
  return { out, ids, sent, asked };
}

describe('the summary tick (D6)', () => {
  it('runs hourly, one at a time', () => {
    expect(config(createSummaryTickFn({ due: async () => [] }))).toMatchObject({
      id: `${inngest.id}-${SUMMARY_TICK_FN_ID}`,
      triggers: [{ cron: '11 * * * *' }],
      concurrency: { limit: 1 },
    });
  });

  it('asks for each due account once, a page at a time, read at one fixed time', async () => {
    const all = due(SUMMARY_PAGE + 3);
    const { out, ids, sent, asked } = await tick(all);
    expect(ids).toEqual(['clock', 'due-0', 'due-1']);
    expect(new Set(asked.map((a) => a[0])).size).toBe(1);
    const events = sent.flatMap((s) => s.events) as {
      name: string;
      id: string;
      data: SummaryRequested;
    }[];
    expect(events.map((e) => e.data)).toEqual(all);
    expect(events[0]).toMatchObject({
      name: 'summary.requested',
      id: `summary:${all[0]!.accountId}:2026-W47`,
    });
    expect(out).toEqual({ requested: SUMMARY_PAGE + 3 });
  });

  it('reads a next page when a page is full, and sends nothing for none due', async () => {
    expect((await tick(due(SUMMARY_PAGE))).ids).toEqual(['clock', 'due-0', 'due-1']);
    const none = await tick([]);
    expect(none.sent).toEqual([]);
    expect(none.out).toEqual({ requested: 0 });
  });
});

describe('the summary send (D6)', () => {
  it('runs on summary.requested within the plan cap, one account per run in one step', async () => {
    const seen: SummaryRequested[] = [];
    const fn = createSummarySendFn(
      {
        send: async (d) => {
          seen.push(d);
          return { sent: 1 };
        },
      },
      { INNGEST_SUMMARY_CONCURRENCY: '99' },
    );
    expect(config(fn)).toMatchObject({
      id: `${inngest.id}-${SUMMARY_SEND_FN_ID}`,
      triggers: [{ event: 'summary.requested' }],
      concurrency: { limit: 5 },
    });
    const ids: string[] = [];
    const out = await (fn as unknown as { fn: (ctx: unknown) => Promise<unknown> }).fn({
      event: { data: due(1)[0] },
      step: {
        run: async (id: string, body: () => Promise<unknown>) => {
          ids.push(id);
          return body();
        },
      },
    });
    expect(ids).toEqual(['send']);
    expect(seen).toEqual(due(1));
    expect(out).toEqual({ sent: 1 });
  });
});
