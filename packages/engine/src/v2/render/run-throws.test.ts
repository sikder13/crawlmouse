/**
 * A word count that throws leaves the page `measure_failed` and the check going on, with the day's
 * reservation settled. measurePage is replaced so the throw can be made to happen.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./page.js', () => ({
  measurePage: () => {
    throw new Error('word count failed');
  },
}));

const { renderCheck } = await import('./run.js');
const { fakeClient, memoryDailyBudget, replyFixtures } = await import('./fakes.js');

describe('a render whose word count throws', () => {
  it('is measure_failed, the check goes on, and the budget is settled at what was used', async () => {
    const f = replyFixtures().get('server-rendered')!;
    const daily = memoryDailyBudget();
    const out = await renderCheck({
      candidates: [
        {
          url: f.url,
          template_key: '/guide',
          kind: 'content',
          status_code: 200,
          is_html: true,
          pagerank_share: 0.5,
          fetched_under_our_robots: true,
        },
      ],
      openFixTemplates: [],
      maxRenders: 25,
      previousStates: new Map(),
      client: fakeClient([f]),
      admit: async () => {},
      caps: { perCheckMs: 600_000, perDayMs: 600_000 },
      daily,
    });
    expect(out.pages[0]).toMatchObject({ rendered: false, reason: 'measure_failed' });
    expect(daily.usedMs()).toBe(f.static.browser_ms + f.rendered.browser_ms);
  });
});
