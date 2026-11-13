/**
 * A rendered page whose links cannot be read keeps its measurement and carries no `links` (run.ts):
 * the throw is that page's alone, and the word counts and the estimate do not depend on it.
 */
import { describe, expect, it, vi } from 'vitest';
import { fakeClient, memoryDailyBudget, replyFixtures } from './fakes.js';
import { renderCheck } from './run.js';

vi.mock('./links.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./links.js')>()),
  renderLinks: () => {
    throw new Error('links unreadable');
  },
}));

describe('a page whose links cannot be read', () => {
  it('is rendered, with its measurement and no links', async () => {
    const f = replyFixtures().get('server-rendered')!;
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
      caps: { perCheckMs: 600_000, perDayMs: 3_600_000 },
      daily: memoryDailyBudget(),
      sleep: async () => {},
    });
    expect(out.pages).toEqual([
      {
        url: f.url,
        template_key: '/guide',
        picked_for: 'template',
        rendered: true,
        without_js: { raw_words: 119, rendered_words: 119, text_share: 1, state: 'readable' },
      },
    ]);
  });
});
