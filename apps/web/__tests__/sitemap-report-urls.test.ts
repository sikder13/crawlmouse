import { describe, it, expect, vi, beforeEach } from 'vitest';

// SPEC 04 §8 (V13) — the sitemap's claimed+indexable /r/ section. Claimed reports appear as absolute
// /r/<slug> URLs; when there are none, no /r/ URL leaks in (unclaimed mints are indexable=false and
// never reach the query — see lib/sitemap-reports). The static marketing/blog set is always present.
// The DB read is stubbed here (its filtering + fail-soft are pinned in lib/sitemap-reports.test.ts).

let reportEntries: Array<{ slug: string; lastModified: string }> = [];
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('@/lib/sitemap-reports', () => ({ fetchIndexableReportSlugs: () => Promise.resolve(reportEntries) }));

import sitemap from '../app/sitemap';

beforeEach(() => { reportEntries = []; });

describe('sitemap /r/ section (V13)', () => {
  it('lists claimed+indexable reports as absolute /r/<slug> URLs', async () => {
    reportEntries = [
      { slug: 'abc', lastModified: '2026-01-01T00:00:00Z' },
      { slug: 'def', lastModified: '2026-02-01T00:00:00Z' },
    ];
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain('https://crawlmouse.com/r/abc');
    expect(urls).toContain('https://crawlmouse.com/r/def');
  });

  it('includes NO /r/ URL when there are no indexable reports (unclaimed mints never leak in)', async () => {
    reportEntries = [];
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls.some((u) => u.includes('/r/'))).toBe(false);
  });

  it('always includes the static marketing/blog set alongside the reports', async () => {
    reportEntries = [{ slug: 'abc', lastModified: '2026-01-01T00:00:00Z' }];
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain('https://crawlmouse.com');
    expect(urls).toContain('https://crawlmouse.com/pricing');
    expect(urls).toContain('https://crawlmouse.com/r/abc');
  });

  it('carries a valid lastModified on each report entry', async () => {
    reportEntries = [{ slug: 'abc', lastModified: '2026-01-01T00:00:00Z' }];
    const entry = (await sitemap()).find((e) => e.url.endsWith('/r/abc'))!;
    expect(entry).toBeTruthy();
    expect(Number.isNaN(new Date(entry.lastModified as string).getTime())).toBe(false);
  });
});
