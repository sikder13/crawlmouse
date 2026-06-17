import { describe, it, expect } from 'vitest';
import { parseRobotsTxt, isAllowedByRobots, getCrawlDelay } from './robots.js';

const sample = `
User-agent: *
Disallow: /admin/
Disallow: /private
Allow: /private/public

Sitemap: https://example.com/sitemap.xml
Sitemap: https://example.com/sitemap_products.xml
`;

describe('parseRobotsTxt', () => {
  it('extracts sitemap URLs', () => {
    const r = parseRobotsTxt(sample);
    expect(r.sitemaps).toEqual([
      'https://example.com/sitemap.xml',
      'https://example.com/sitemap_products.xml',
    ]);
  });

  it('extracts disallow + allow rules for wildcard UA', () => {
    const r = parseRobotsTxt(sample);
    expect(r.rules['*']?.disallow).toEqual(['/admin/', '/private']);
    expect(r.rules['*']?.allow).toEqual(['/private/public']);
  });
});

describe('isAllowedByRobots', () => {
  const r = parseRobotsTxt(sample);

  it.each([
    ['/products/x', true],
    ['/admin/users', false],
    ['/private', false],
    ['/private/public', true],
  ])('path %s allowed=%s', (path, expected) => {
    expect(isAllowedByRobots(r, 'CrawlmouseBot', path)).toBe(expected);
  });
});

describe('parseRobotsTxt - grouping + BOM edge cases', () => {
  it('shares rules across consecutive user-agent lines', () => {
    const r = parseRobotsTxt('User-agent: GoogleBot\nUser-agent: CrawlmouseBot\nDisallow: /x');
    expect(r.rules['googlebot']?.disallow).toEqual(['/x']);
    expect(r.rules['crawlmousebot']?.disallow).toEqual(['/x']);
  });

  it('attributes directives before any user-agent line to *', () => {
    const r = parseRobotsTxt('Disallow: /pre\nUser-agent: *\nDisallow: /post');
    expect(r.rules['*']?.disallow).toEqual(['/pre', '/post']);
  });

  it('parses despite a leading BOM', () => {
    const r = parseRobotsTxt('\uFEFFUser-agent: *\nDisallow: /x');
    expect(r.rules['*']?.disallow).toEqual(['/x']);
  });
});

describe('Crawl-delay parsing + getCrawlDelay (§5 hard floor)', () => {
  it('parses a wildcard Crawl-delay', () => {
    const r = parseRobotsTxt('User-agent: *\nCrawl-delay: 2\nDisallow: /x');
    expect(r.rules['*']?.crawlDelay).toBe(2);
    // does not disturb allow/disallow parsing
    expect(r.rules['*']?.disallow).toEqual(['/x']);
  });

  it('parses a per-UA Crawl-delay and prefers the specific group over *', () => {
    const r = parseRobotsTxt('User-agent: CrawlmouseBot\nCrawl-delay: 3\nUser-agent: *\nCrawl-delay: 9');
    expect(r.rules['crawlmousebot']?.crawlDelay).toBe(3);
    expect(getCrawlDelay(r, 'CrawlmouseBot')).toBe(3);
  });

  it('falls back to the * group when the UA has no specific group', () => {
    const r = parseRobotsTxt('User-agent: *\nCrawl-delay: 2');
    expect(getCrawlDelay(r, 'CrawlmouseBot')).toBe(2);
  });

  it('does not apply another bot’s Crawl-delay to us', () => {
    const r = parseRobotsTxt('User-agent: GoogleBot\nCrawl-delay: 7');
    expect(getCrawlDelay(r, 'CrawlmouseBot')).toBeUndefined();
  });

  it('ignores a malformed or negative Crawl-delay', () => {
    expect(getCrawlDelay(parseRobotsTxt('User-agent: *\nCrawl-delay: abc'), 'Bot')).toBeUndefined();
    expect(getCrawlDelay(parseRobotsTxt('User-agent: *\nCrawl-delay: -1'), 'Bot')).toBeUndefined();
  });

  it('returns undefined when no Crawl-delay is declared', () => {
    expect(getCrawlDelay(parseRobotsTxt('User-agent: *\nDisallow: /x'), 'Bot')).toBeUndefined();
  });
});

describe('isAllowedByRobots - RFC 9309 wildcards (* and $)', () => {
  const r = parseRobotsTxt(
    'User-agent: *\nDisallow: /*.pdf$\nDisallow: /search\nAllow: /search/help\nDisallow: /a/*/private',
  );

  it.each([
    ['/file.pdf', false, '*.pdf$ matches'],
    ['/file.pdf?download=1', true, '$ anchors the end; query after .pdf is not blocked'],
    ['/search', false, 'prefix disallow'],
    ['/search/help', true, 'more-specific allow wins on a longer match'],
    ['/a/x/private', false, '/a/*/private wildcard segment'],
    ['/a/private', true, 'no middle segment, so the wildcard rule does not match'],
    ['/index.html', true, 'no rule matches'],
  ])('path %s allowed=%s (%s)', (path, expected) => {
    expect(isAllowedByRobots(r, 'Bot', path)).toBe(expected);
  });

  it('is not vulnerable to ReDoS on a heavily-wildcarded rule (attacker robots.txt)', () => {
    // A regex translation (* -> .*) backtracks catastrophically here (~minutes per
    // call). The linear matcher must evaluate a non-matching long path instantly.
    const evil = parseRobotsTxt('User-agent: *\nDisallow: /' + '*a'.repeat(40) + '$');
    const path = '/' + 'a'.repeat(120); // long, ends in 'a' but never satisfies the $ anchor structure
    const start = performance.now();
    const allowed = isAllowedByRobots(evil, 'Bot', path);
    const elapsedMs = performance.now() - start;
    expect(typeof allowed).toBe('boolean');
    expect(elapsedMs).toBeLessThan(50);
  });
});
