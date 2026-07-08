import { describe, it, expect, beforeAll, vi } from 'vitest';
import robots from '../app/robots';
import sitemap from '../app/sitemap';
import { allPostSlugs } from '../lib/blog/posts';

// The sitemap is now async + DB-backed: it appends a CLAIM-GATED /r/ section (SPEC 04 §8) — claimed +
// indexable reports are listed; unclaimed mints (indexable=false) never are. We stub the report source
// to EMPTY here so this guard deterministically pins (a) the static marketing/legal/blog set, (b) that
// an empty/unclaimed world leaks NO /r/ URL — the guardrail — and (c) the private-path exclusions. The
// DYNAMIC claimed case (real /r/<slug> URLs appear) is pinned separately in sitemap-report-urls.test.ts,
// and the filter/fail-soft in lib/sitemap-reports.test.ts. `/compare/` stays excluded for this whole
// phase (M3: compare is noindex; the slug-based indexable compare is deferred post-SPEC-04).
//
// SEO crawl-control invariants. robots was historically malformed (two separate `User-Agent: *`
// groups, which crawlers merge or pick from inconsistently) and there was no sitemap. These guards
// pin the corrected shape + the full indexable URL set so a refactor can't silently de-index pages
// or leak private paths into the sitemap.
// robots blocks the private app surfaces but NOT /r/ — /r/ indexing is controlled per-page (page
// robots meta) so the crawler can fetch the page and honor it, rather than the "indexed but blocked"
// anti-pattern.
// Leaderboards (/top/*) follow the SAME page-controlled policy: their page robots meta is noindex
// while the board is empty/thin and flips to indexable once real ranked data accrues, so they are
// intentionally NOT auto-listed in the sitemap (no empty doorway pages advertised to crawlers).

// Empty report source → the guard sees the static set only (deterministic, no DB / no env).
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('@/lib/sitemap-reports', () => ({ fetchIndexableReportSlugs: () => Promise.resolve([]) }));

const ROBOTS_DISALLOW = ['/embed/', '/audit/', '/dashboard', '/verify/'];
// /r/ is NO LONGER categorically excluded — it is claim-gated (listed only when a report is claimed +
// indexable). Everything below stays private/non-indexable and must never appear in the sitemap.
const SITEMAP_EXCLUDE = ['/embed/', '/audit/', '/dashboard', '/verify/', '/login', '/api/', '/compare/'];

describe('robots.ts', () => {
  it('emits exactly one User-Agent:* group (allow / + private disallows) and references the sitemap', () => {
    const r = robots();
    const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
    const star = rules.filter(
      (g) => g.userAgent === '*' || (Array.isArray(g.userAgent) && g.userAgent.includes('*')),
    );
    expect(star, 'must be exactly ONE User-Agent:* group').toHaveLength(1);
    expect(star[0]!.allow).toBe('/');
    const dis = ([] as string[]).concat(star[0]!.disallow ?? []);
    for (const p of ROBOTS_DISALLOW) expect(dis, `robots must disallow ${p}`).toContain(p);
    expect(dis, 'robots must NOT block /r/ — its indexing is page-controlled').not.toContain('/r/');
    expect(String(r.sitemap)).toContain('https://crawlmouse.com/sitemap.xml');
  });
});

describe('sitemap.ts', () => {
  let urls: string[];
  beforeAll(async () => {
    urls = (await sitemap()).map((e) => e.url);
  });
  const has = (p: string) => urls.includes('https://crawlmouse.com' + p);

  it('lists every indexable marketing / legal / blog URL as an absolute crawlmouse.com URL', () => {
    for (const u of urls) expect(u).toMatch(/^https:\/\/crawlmouse\.com(\/|$)/);
    expect(urls, 'home').toContain('https://crawlmouse.com');
    for (const p of ['/pricing', '/developers', '/status', '/bot', '/privacy', '/terms', '/aup', '/subprocessors', '/blog']) {
      expect(has(p), `sitemap must include ${p}`).toBe(true);
    }
    // Leaderboards (/top/*) are page-controlled (noindex while empty/thin, indexable once
    // real ranked data accrues — robots meta in app/top/[platform]/page.tsx), same rationale
    // as an unclaimed /r/. So they are NOT auto-listed in the sitemap.
    expect(
      urls.some((u) => u.includes('/top/')),
      'leaderboards are page-controlled (noindex when empty), not sitemap-listed',
    ).toBe(false);
    for (const slug of allPostSlugs()) expect(has('/blog/' + slug), `sitemap must include /blog/${slug}`).toBe(true);
  });

  it('leaks NO /r/ URL when there are no claimed+indexable reports (the claim-gate guardrail)', () => {
    // With the report source stubbed empty, an unclaimed/empty world must advertise no report page.
    expect(urls.some((u) => u.includes('/r/')), 'unclaimed/empty → no /r/ in the sitemap').toBe(false);
  });

  it('excludes private / non-indexable paths (incl. /compare/ — noindex this phase, M3)', () => {
    for (const bad of SITEMAP_EXCLUDE) {
      expect(urls.some((u) => u.includes(bad)), `sitemap must NOT include ${bad}`).toBe(false);
    }
  });

  it('every entry has a VALID lastModified date', async () => {
    for (const e of await sitemap()) {
      expect(e.lastModified, `${e.url} needs lastModified`).toBeTruthy();
      const t = new Date(e.lastModified as string | number | Date).getTime();
      expect(Number.isNaN(t), `${e.url} lastModified must be a valid date`).toBe(false);
    }
  });
});
