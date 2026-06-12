import { describe, it, expect } from 'vitest';
import robots from '../app/robots';
import sitemap from '../app/sitemap';
import { allPostSlugs } from '../lib/blog/posts';

// SEO crawl-control invariants. robots was historically malformed (two separate `User-Agent: *`
// groups, which crawlers merge or pick from inconsistently) and there was no sitemap. These guards
// pin the corrected shape + the full indexable URL set so a refactor can't silently de-index pages
// or leak private paths into the sitemap.
// robots blocks the private app surfaces but NOT /r/ — /r/ indexing is controlled per-page (page
// robots meta) so the crawler can fetch the page and honor it, rather than the "indexed but blocked"
// anti-pattern. The sitemap still omits /r/ (it's not part of our intended indexable set here).
const ROBOTS_DISALLOW = ['/embed/', '/audit/', '/dashboard', '/verify/'];
const SITEMAP_EXCLUDE = ['/r/', '/embed/', '/audit/', '/dashboard', '/verify/', '/login', '/api/', '/compare/'];

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
  const urls = sitemap().map((e) => e.url);
  const has = (p: string) => urls.includes('https://crawlmouse.com' + p);

  it('lists every indexable marketing / legal / blog URL as an absolute crawlmouse.com URL', () => {
    for (const u of urls) expect(u).toMatch(/^https:\/\/crawlmouse\.com(\/|$)/);
    expect(urls, 'home').toContain('https://crawlmouse.com');
    for (const p of ['/pricing', '/developers', '/status', '/bot', '/privacy', '/terms', '/aup', '/subprocessors', '/blog']) {
      expect(has(p), `sitemap must include ${p}`).toBe(true);
    }
    expect(urls.some((u) => u.includes('/top/shopify')), 'leaderboards').toBe(true);
    for (const slug of allPostSlugs()) expect(has('/blog/' + slug), `sitemap must include /blog/${slug}`).toBe(true);
  });

  it('excludes private / non-indexable paths', () => {
    for (const bad of SITEMAP_EXCLUDE) {
      expect(urls.some((u) => u.includes(bad)), `sitemap must NOT include ${bad}`).toBe(false);
    }
  });

  it('every entry has a VALID lastModified date', () => {
    for (const e of sitemap()) {
      expect(e.lastModified, `${e.url} needs lastModified`).toBeTruthy();
      const t = new Date(e.lastModified as string | number | Date).getTime();
      expect(Number.isNaN(t), `${e.url} lastModified must be a valid date`).toBe(false);
    }
  });
});
