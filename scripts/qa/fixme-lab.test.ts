import { describe, expect, it } from 'vitest';
import handler, {
  answer,
  bylineAt,
  hostOf,
  paths,
  HOSTS,
  // @ts-expect-error a plain .mjs served by Vercel as it is, with no declaration file
} from '../../fixtures/qa-lab/api/fixme.mjs';
import { readPage } from '../../packages/engine/src/v2/content/read';
import { judgePage } from '../../packages/engine/src/v2/content/checks';
import { aggregateContent } from '../../packages/engine/src/v2/content/aggregate';

// Row 22, "Fixed, and proven" (c/043): the fix a check of fixme.lab raises on an even UTC day, and
// that the next day's check verifies, read through the engine's own content reader, page judgement
// and template rule, not asserted from the module's tables.

const HOST = 'fixme.lab.crawlmouse.com';
// Day numbers counted apart from the code: 2026-11-25 is day 20782 (even), 2026-11-26 day 20783.
const EVEN = Date.UTC(2026, 10, 25, 15, 0);
const ODD = Date.UTC(2026, 10, 26, 15, 0);
type Answer = { status: number; type: string; body: string };
const get = (path: string, now: number): Answer => answer({ host: HOST, path, now }) as Answer;
const all = paths() as string[];
const articles = all.filter((p) => p.startsWith('/articles/') && p !== '/articles/');

/** The engine's template for a page: articles share one, every other page is its own. */
const templateOf = (p: string) => (articles.includes(p) ? '/articles/*' : p);
const checkOn = (now: number) =>
  aggregateContent(
    all.map((url) => ({
      url,
      template_key: templateOf(url),
      features: readPage(get(url, now).body),
    })),
  );
const authorDate = (now: number) =>
  checkOn(now).detections.find(
    (d) => d.type === 'missing_author_date' && d.template_key === '/articles/*',
  )!;

describe('the fixme lab (row 22, c/043)', () => {
  it('names its host and serves nine pages, six of them articles', () => {
    expect(HOSTS).toEqual({ fixme: HOST });
    expect(all).toHaveLength(9);
    expect(articles).toHaveLength(6);
    for (const p of all)
      expect([p, get(p, EVEN).status, get(p, ODD).status]).toEqual([p, 200, 200]);
  });

  it('drops the byline on an even UTC day and restores it on an odd one, turning at midnight', () => {
    expect([bylineAt(EVEN), bylineAt(ODD)]).toEqual([false, true]);
    expect(bylineAt(Date.UTC(2026, 10, 25, 23, 59, 59, 999))).toBe(false);
    expect(bylineAt(Date.UTC(2026, 10, 26, 0, 0, 0, 0))).toBe(true);
  });

  it('fails every article on the engine’s author_and_date check on an even day, and passes each on an odd one', () => {
    for (const p of articles) {
      expect([p, judgePage(readPage(get(p, EVEN).body)).author_and_date]).toEqual([p, 'fail']);
      expect([p, judgePage(readPage(get(p, ODD).body)).author_and_date]).toEqual([p, 'pass']);
    }
    // Pages that are not articles carry no Article node: the check does not apply to them.
    for (const p of all.filter((x) => !articles.includes(x))) {
      expect(judgePage(readPage(get(p, EVEN).body)).author_and_date).toBe('not_applicable');
    }
  });

  it('raises missing_author_date on the article template on an even day, and clears it on an odd one', () => {
    const even = authorDate(EVEN);
    expect([even.state, even.extent]).toEqual(['detected', { failing: 6, of: 6, unread: 0 }]);
    expect(even.affected_urls).toHaveLength(6);
    const odd = authorDate(ODD);
    expect([odd.state, odd.extent]).toEqual(['not_detected', { failing: 0, of: 6, unread: 0 }]);
  });

  it('changes nothing else between the days: every other detection reads the same', () => {
    const others = (now: number) =>
      checkOn(now)
        .detections.filter((d) => d.type !== 'missing_author_date')
        .map((d) => [d.type, d.template_key, d.state]);
    expect(others(ODD)).toEqual(others(EVEN));
    // The Article node keeps its description, so missing_schema_description opens on neither day.
    for (const now of [EVEN, ODD]) {
      const schema = checkOn(now).detections.find(
        (d) => d.type === 'missing_schema_description' && d.template_key === '/articles/*',
      );
      expect(schema?.state ?? 'not_detected').toBe('not_detected');
    }
  });

  it('carries no byline markup of any kind on an even day', () => {
    for (const p of articles) {
      const html = get(p, EVEN).body;
      for (const mark of [
        '"author"',
        'datePublished',
        '<time',
        'itemprop="author"',
        'article:published_time',
        'rel="author"',
        'name="author"',
      ]) {
        expect(html, `${p} ${mark}`).not.toContain(mark);
      }
    }
  });

  it('answers 404 to a path it does not have and to another host, and prefers its own Host to a forwarded one', () => {
    for (const p of ['/articles/none/', '/articles/gold-tooling', '/../api/fixme.mjs']) {
      expect(get(p, EVEN).status, p).toBe(404);
    }
    expect(
      (answer({ host: 'dense.lab.crawlmouse.com', path: '/', now: EVEN }) as Answer).status,
    ).toBe(404);
    expect(hostOf({ host: HOST, 'x-forwarded-host': 'evil.test' })).toBe(HOST);
    expect(hostOf({ host: 'x.vercel.app', 'x-forwarded-host': HOST })).toBe(HOST);
    const served = (headers: Record<string, string>) => {
      const res = {
        statusCode: 0,
        headers: {} as Record<string, string>,
        body: '',
        setHeader(k: string, v: string) {
          this.headers[k.toLowerCase()] = v;
        },
        end(b: string) {
          this.body = b;
        },
      };
      handler({ url: '/api/fixme?path=%2F', headers }, res);
      return res;
    };
    expect(served({ host: HOST }).statusCode).toBe(200);
    expect(served({ host: HOST }).headers['cache-control']).toBe('no-store');
    expect(served({ host: 'x.vercel.app', 'x-forwarded-host': 'evil.test' }).statusCode).toBe(404);
  });
});
