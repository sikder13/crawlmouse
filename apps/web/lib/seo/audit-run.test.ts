import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { auditBuild, isNoindex, sitemapLocs } from './audit-run';
import { renderReport } from './audit-report';
import { APP_SURFACES } from './app-surfaces';

const BASE = 'http://localhost:3100';
const ORIGIN = 'https://crawlmouse.com';
const post = (body: string, extra = '') =>
  `<html><head><title>T</title><link rel="canonical" href="${ORIGIN}/blog/a">${extra}</head><body><main><h1>H</h1>${body}</main></body></html>`;
const SHARED = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda';

const SITE: Record<string, { status: number; body?: string; headers?: Record<string, string> }> = {
  '/sitemap.xml': {
    status: 200,
    body: `<urlset><url><loc>${ORIGIN}/blog/a</loc></url><url><loc>${ORIGIN}/blog/b</loc></url><url><loc>${ORIGIN}/blog/c</loc></url></urlset>`,
  },
  '/blog/a': { status: 200, body: post(`<p>${SHARED}</p><a href="/blog/b">b</a>`) },
  '/blog/b': { status: 200, body: post(`<p>${SHARED} mu</p>`) },
  '/blog/c': { status: 200, body: post('<p>unrelated words entirely here now ok</p>') },
  '/login': {
    status: 200,
    body: '<html><head><meta name="robots" content="noindex, follow"></head><body></body></html>',
  },
  '/dashboard': { status: 307, headers: { location: `${BASE}/login` } },
  '/signup': { status: 200, body: '<html><head></head><body>open</body></html>' },
};

const fakeFetch = async (url: string) => {
  const path = new URL(url).pathname;
  const page = SITE[path] ?? { status: 404 };
  return new Response(page.body ?? '', { status: page.status, headers: page.headers });
};

describe('auditBuild', () => {
  it('reads the sitemap, every listed page and every app surface', async () => {
    const run = await auditBuild({
      base: BASE,
      origin: ORIGIN,
      label: 'flags off',
      sha: 'abc',
      fetch: fakeFetch,
      parse: (h) => new JSDOM(h).window.document,
      now: () => new Date('2026-11-15T12:00:00Z'),
    });
    expect(run.sitemap).toEqual(['/blog/a', '/blog/b', '/blog/c']);
    expect(run.surfaces.map((s) => s.path)).toEqual([...APP_SURFACES]);
    expect(run.surfaces.find((s) => s.path === '/dashboard')).toMatchObject({
      status: 307,
      location: '/login',
    });
    expect(isNoindex(run.surfaces.find((s) => s.path === '/login')!.robots)).toBe(true);
    // a and b share most of their words; c shares none
    expect(run.pages[0]!.nearest!.path).toBe('/blog/b');
    expect(run.pages[0]!.nearest!.jaccard).toBeGreaterThan(0.5);
    expect(run.pages[2]!.nearest!.jaccard).toBe(0);
    expect(run.pages[0]).not.toHaveProperty('mainText');

    const md = renderReport({
      origin: ORIGIN,
      off: run,
      on: { ...run, label: 'flags on' },
      posts: [],
      www: { status: 308, location: `${ORIGIN}/`, checkedAt: 'now' },
      commands: ['x'],
    });
    // /signup answered an indexable 200: the report names it rather than claiming all are noindex
    expect(md).toContain(
      'App surfaces answering an indexable page: /signup (flags off), /signup (flags on).',
    );
    expect(md).toContain('| /dashboard | 307 → /login | 307 → /login |');
    expect(md).toContain('answered one 308 to https://crawlmouse.com/: not separately indexable');
    // canonical of /blog/b and /blog/c point at /blog/a: counted as not self
    expect(md).toMatch(/\| canonical not the page itself \| 2 \| 2 \|/);
    // /blog/a has no in-link from another page; b has one (from a); c none
    expect(md).toMatch(/\| no internal link to it from another sitemap page \| 2 \| 2 \|/);
  });

  it('refuses a sitemap URL on another origin', async () => {
    const bad = async () => new Response(`<loc>https://evil.test/x</loc>`, { status: 200 });
    await expect(
      auditBuild({
        base: BASE,
        origin: ORIGIN,
        label: 'x',
        sha: 'x',
        fetch: bad,
        parse: (h) => new JSDOM(h).window.document,
      }),
    ).rejects.toThrow('not on');
  });

  it('sitemapLocs unescapes &amp;', () => {
    expect(sitemapLocs('<loc> https://a/?x=1&amp;y=2 </loc>')).toEqual(['https://a/?x=1&y=2']);
  });

  it('isNoindex reads noindex and none, not words that contain them', () => {
    expect(isNoindex(['noindex, follow'])).toBe(true);
    expect(isNoindex(['none'])).toBe(true);
    expect(isNoindex(['index, follow', 'nonesuch'])).toBe(false);
  });
});

describe('renderReport www verdict', () => {
  it('says so when www is not one permanent redirect to the apex', () => {
    const run = {
      label: 'flags off',
      sha: 'abc',
      takenAt: 't',
      sitemap: [],
      pages: [],
      surfaces: [],
    };
    const md = renderReport({
      origin: ORIGIN,
      off: run,
      on: run,
      posts: [],
      www: { status: 302, location: 'https://www.crawlmouse.com/x', checkedAt: 'now' },
      commands: [],
    });
    expect(md).toContain('NOT a single permanent redirect');
  });
});
