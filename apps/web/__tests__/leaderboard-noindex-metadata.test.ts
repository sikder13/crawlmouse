import { describe, it, expect, vi } from 'vitest';

// Page-controlled indexing for /top/[platform]: generateMetadata runs a COUNT of qualifying
// ranked reports and returns robots.index = (count >= LEADERBOARD_MIN_INDEX). The COUNT is the
// only input, so we stub supabaseAdmin() with a chainable builder whose awaited value is
// { count } — no real DB. mocks.count is what the next generateMetadata() call will see.
const mocks = vi.hoisted(() => ({ count: 0 as number | null }));

vi.mock('@/lib/supabase/admin', () => {
  const builder: Record<string, unknown> = {};
  for (const method of ['from', 'select', 'eq', 'is', 'not', 'order', 'limit']) {
    builder[method] = () => builder;
  }
  // Thenable: `await supabaseAdmin().from(...).select(...)...` resolves here.
  (builder as { then: unknown }).then = (resolve: (v: { count: number | null }) => unknown) =>
    resolve({ count: mocks.count });
  return { supabaseAdmin: () => builder };
});

import { generateMetadata } from '../app/top/[platform]/page';

const meta = (platform: string) => generateMetadata({ params: Promise.resolve({ platform }) });

describe('top/[platform] generateMetadata — noindex until the board has data', () => {
  it('noindex + no description when the board is empty', async () => {
    mocks.count = 0;
    const m = await meta('shopify');
    expect(m.robots).toEqual({ index: false, follow: true });
    expect(m.description).toBeUndefined();
    expect(m.title).toBe('Top shopify sites — Crawlmouse leaderboard');
  });

  it('still noindex when thin (one below the minimum)', async () => {
    mocks.count = 9;
    const m = await meta('wordpress');
    expect(m.robots).toEqual({ index: false, follow: true });
    expect(m.description).toBeUndefined();
  });

  it('becomes indexable with a real description at the minimum', async () => {
    mocks.count = 10;
    const m = await meta('wordpress');
    expect(m.robots).toEqual({ index: true, follow: true });
    expect(m.description).toBe('The top wordpress sites ranked by internal-linking grade.');
  });

  it('stays indexable well above the minimum', async () => {
    mocks.count = 250;
    const m = await meta('shopify');
    expect(m.robots).toEqual({ index: true, follow: true });
  });

  it('never indexes an unknown platform, regardless of any count', async () => {
    mocks.count = 9999;
    const m = await meta('not-a-real-platform');
    expect(m.robots).toEqual({ index: false, follow: true });
    expect(m.description).toBeUndefined();
  });

  it('treats a null count (query returned no count) as not indexable', async () => {
    mocks.count = null;
    const m = await meta('shopify');
    expect(m.robots).toEqual({ index: false, follow: true });
  });
});
