/**
 * CC-40 D3: each sitemap entry's lastModified is a real date or absent. Posts keep their updatedAt;
 * /blog, /guides, tag and author pages take the newest updatedAt among the posts they list; the
 * legal pages take the "Last updated" date each one shows; every other page omits it rather than
 * claim the time of the build. Which paths may omit it is pinned in seo-robots-sitemap-guard.test.ts.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('@/lib/sitemap-reports', () => ({ fetchIndexableReportSlugs: async () => [] }));

import sitemap from '../app/sitemap';
import { POSTS } from '../lib/blog/posts';
import { CLUSTERS } from '../lib/blog/clusters';

const ORIGIN = 'https://crawlmouse.com';
const at = async (path: string) => {
  const e = (await sitemap()).find((x) => x.url === (path === '/' ? ORIGIN : `${ORIGIN}${path}`));
  if (!e) throw new Error(`${path} not in the sitemap`);
  return e.lastModified === undefined ? undefined : new Date(e.lastModified).toISOString();
};
const day = (iso: string) => new Date(iso).toISOString();
const newest = (dates: string[]) => day(dates.reduce((a, b) => (b > a ? b : a)));

afterEach(() => vi.unstubAllEnvs());

describe('sitemap lastModified', () => {
  it('a post keeps its updatedAt', async () => {
    for (const p of POSTS) expect(await at(`/blog/${p.slug}`), p.slug).toBe(day(p.updatedAt));
  });

  it('/blog is its newest post’s updatedAt, /guides the newest among the posts it lists', async () => {
    expect(await at('/blog')).toBe(newest(POSTS.map((p) => p.updatedAt)));
    const listed = new Set(CLUSTERS.flatMap((c) => c.slugs));
    expect(await at('/guides')).toBe(
      newest(POSTS.filter((p) => listed.has(p.slug)).map((p) => p.updatedAt)),
    );
  });

  it.each([
    ['/privacy', () => import('../app/privacy/page')],
    ['/terms', () => import('../app/terms/page')],
    ['/aup', () => import('../app/aup/page')],
    ['/subprocessors', () => import('../app/subprocessors/page')],
  ] as const)('%s is the "Last updated" date the page shows', async (path, load) => {
    const { default: Page } = await load();
    const shown = renderToStaticMarkup(Page() as ReactElement).match(
      /Last updated: (\d{4}-\d{2}-\d{2})/,
    );
    expect(shown, `${path} shows a date`).not.toBeNull();
    expect(await at(path)).toBe(day(shown![1]!));
  });

  it('a page with no date of its own omits it, in both builds', async () => {
    expect(await at('/')).toBeUndefined();
    expect(await at('/takedown')).toBeUndefined();
    vi.stubEnv('V2_BILLING', '1');
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    expect(await at('/agencies')).toBeUndefined();
    expect(await at('/check/gptbot')).toBeUndefined();
    expect(await at('/help')).toBeUndefined();
  });

  it('no entry claims the time the sitemap was built', async () => {
    vi.stubEnv('V2_BILLING', '1');
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    const before = Date.now() - 60_000;
    for (const e of await sitemap())
      if (e.lastModified !== undefined)
        expect(new Date(e.lastModified).getTime(), e.url).toBeLessThan(before);
  });
});
