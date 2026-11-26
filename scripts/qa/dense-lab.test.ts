import { describe, expect, it } from 'vitest';
import handler, {
  answer,
  hostOf,
  linksOf,
  NOTE_LINKS,
  paths,
  HOSTS,
  // @ts-expect-error a plain .mjs served by Vercel as it is, with no declaration file
} from '../../fixtures/qa-lab/api/dense.mjs';
import { extractPage } from '../../packages/engine/src/extract';

// c/038: a lab site of 2,000 pages with about 100 internal links each, about 200,000 edges, the same
// on every check, for the persist work. The figures below are read from the served HTML through the
// engine's own extractor, not from the module's tables, so they are what a crawl of it would find.

const HOST = 'dense.lab.crawlmouse.com';
const ORIGIN = `https://${HOST}`;
type Answer = { status: number; type: string; body: string };
const get = (path: string): Answer => answer({ host: HOST, path }) as Answer;
const all = paths() as string[];

/** The distinct same-site pages a served page links to, as the engine's extractor reads them. */
function served(path: string): string[] {
  const page = extractPage(get(path).body, `${ORIGIN}${path}`);
  const out = new Set<string>();
  for (const l of page.links) {
    const u = new URL(l.toUrl);
    // The extractor writes a URL in the engine's canonical form, without a trailing slash; the site's
    // paths keep theirs.
    const to = u.pathname === '/' ? '/' : `${u.pathname.replace(/\/$/, '')}/`;
    if (u.host === HOST && to !== path) out.add(to);
  }
  return [...out];
}

describe('the dense lab (c/038)', () => {
  it('names its host', () => {
    expect(HOSTS).toEqual({ dense: HOST });
  });

  it('has 2,000 pages, the home page first, each answered 200 as HTML', () => {
    expect(all).toHaveLength(2000);
    expect(all[0]).toBe('/');
    expect(new Set(all).size).toBe(2000);
    for (const p of ['/', '/s/01/', '/s/20/', '/p/0001/', '/p/1979/']) {
      const a = get(p);
      expect([p, a.status, a.type]).toEqual([p, 200, 'text/html; charset=utf-8']);
    }
  });

  it('serves about 100 links a page, about 200,000 in all, read from the HTML', () => {
    let total = 0;
    let fewest = Infinity;
    let most = 0;
    for (const p of all) {
      const n = served(p).length;
      total += n;
      fewest = Math.min(fewest, n);
      most = Math.max(most, n);
    }
    // Notes hold NOTE_LINKS each; sections 99 or 100 (their notes and the home page); the home 100.
    expect(NOTE_LINKS).toBe(100);
    expect([fewest, most]).toEqual([99, 100]);
    expect(total).toBeGreaterThanOrEqual(199_000);
    expect(total).toBeLessThanOrEqual(200_000);
  });

  it('links each page only to pages the site has', () => {
    const known = new Set(all);
    for (const p of all)
      for (const to of served(p)) expect(known.has(to), `${p} -> ${to}`).toBe(true);
  });

  it('reaches every page from the home page within two clicks', () => {
    const depth = new Map<string, number>([['/', 0]]);
    const queue = ['/'];
    while (queue.length) {
      const p = queue.shift()!;
      for (const to of served(p)) {
        if (depth.has(to)) continue;
        depth.set(to, depth.get(p)! + 1);
        queue.push(to);
      }
    }
    expect(depth.size).toBe(2000);
    expect(Math.max(...depth.values())).toBe(2);
  });

  it('is the same on every request: links and prose come from the path', () => {
    for (const p of ['/', '/s/07/', '/p/0042/', '/p/1979/']) {
      expect(get(p).body).toBe(get(p).body);
      expect(linksOf(p)).toEqual(linksOf(p));
    }
    expect(get('/p/0042/').body).not.toBe(get('/p/0043/').body);
  });

  it('lists every page in its sitemap and allows every crawler in robots.txt', () => {
    const sitemap = get('/sitemap.xml').body;
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual(all.map((p) => `${ORIGIN}${p}`));
    expect(get('/robots.txt').body).toBe(
      `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`,
    );
  });

  it('answers 404 to a path it does not have and to any other host', () => {
    for (const p of ['/p/0000/', '/p/1980/', '/s/21/', '/../api/dense.mjs', '/p/0001']) {
      expect(get(p).status, p).toBe(404);
    }
    expect((answer({ host: 'large.lab.crawlmouse.com', path: '/' }) as Answer).status).toBe(404);
    expect(hostOf({ host: 'Dense.lab.crawlmouse.com:443' })).toBe(HOST);
    expect(hostOf({ host: 'x.vercel.app', 'x-forwarded-host': HOST })).toBe(HOST);
  });

  // QA's gate on #220, M4: a forwarded host must not win over a Host that names this site, and a
  // forged one must reach a 404, never a page or an error.
  it('prefers its own Host to any X-Forwarded-Host, and answers a forged one 404 through the handler', () => {
    expect(hostOf({ host: HOST, 'x-forwarded-host': 'evil.test' })).toBe(HOST);
    const served = (headers: Record<string, string>) => {
      const res = {
        statusCode: 0,
        body: '',
        setHeader: () => {},
        end(b: string) {
          this.body = b;
        },
      };
      handler({ url: '/api/dense?path=%2Fp%2F0001%2F', headers }, res);
      return res.statusCode;
    };
    expect(served({ host: HOST, 'x-forwarded-host': 'evil.test' })).toBe(200);
    expect(served({ host: 'x.vercel.app', 'x-forwarded-host': 'evil.test' })).toBe(404);
    expect(served({ host: 'evil.test' })).toBe(404);
  });
});
