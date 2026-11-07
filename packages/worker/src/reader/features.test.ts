/**
 * What the reader adds to a crawl page for the check builder (CC-20a): the engine's content features,
 * v1's main-content length and meta noindex, and the CMS on request. Each is read from the same body
 * the words were counted on, and none from a page read only in part.
 */
import { extractPage, readContentFeatures } from '@crawlmouse/engine/worker';
import * as cheerio from 'cheerio';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_JSON_LD_NODES } from '@crawlmouse/types/v2';
import { contentFeatures, FEATURES_OVER_BOUNDS, readPage } from './read.js';

const URL_ = 'https://a.test/p';
const read = (body: string, bodyCut = false, stackHeaders: Record<string, string> | null = null) =>
  readPage({ body, bodyCut, finalUrl: URL_, stackHeaders }).read!;

const ARTICLE =
  '<html><head><title>T</title>' +
  '<script type="application/ld+json">{"@type":"Product","description":"A tent."}</script>' +
  '</head><body><nav>menu</nav><h1>Two-person tent</h1>' +
  '<p>This tent sleeps two people and packs down to the size of a loaf of bread.</p>' +
  '</body></html>';

describe('content features', () => {
  it('are what the engine reads of the page', () => {
    const r = read(ARTICLE);
    expect(r.features).toEqual(readContentFeatures(ARTICLE));
    // Independently of the engine: the H1 and the one JSON-LD node the page wrote.
    expect(r.features).toMatchObject({ has_h1: true, client_rendered: false });
    expect(r.features!.json_ld).toEqual([
      {
        types: ['Product'],
        has_description: true,
        has_author: false,
        has_dated_publication: false,
      },
    ]);
    expect(r.featuresNote).toBeNull();
  });

  it('are not read from a page read only in part', () => {
    const r = readPage({ body: ARTICLE, bodyCut: true, finalUrl: URL_ }).read!;
    expect(r.features).toBeNull();
    expect(r.mainTextChars).toBeNull();
    expect(r.metaNoindex).toBeNull();
  });

  it(`are not kept, and say so, past ${MAX_JSON_LD_NODES} JSON-LD nodes`, () => {
    const nodes = (n: number) =>
      `<script type="application/ld+json">${JSON.stringify(
        Array.from({ length: n }, () => ({ '@type': 'Thing' })),
      )}</script>`;
    const at = contentFeatures(
      `<html><head>${nodes(MAX_JSON_LD_NODES)}</head><body></body></html>`,
    );
    expect(at.features!.json_ld).toHaveLength(MAX_JSON_LD_NODES);
    const past = contentFeatures(
      `<html><head>${nodes(MAX_JSON_LD_NODES + 1)}</head><body></body></html>`,
    );
    expect(past).toEqual({ features: null, note: FEATURES_OVER_BOUNDS });
  });

  it('are not kept from a page naming a JSON-LD type that cannot be stored as written', () => {
    const page = `<html><head><script type="application/ld+json">{"@type":"Pro\\u0000duct"}</script></head><body></body></html>`;
    expect(contentFeatures(page)).toEqual({ features: null, note: FEATURES_OVER_BOUNDS });
  });
});

describe('stack signals', () => {
  it('are read only when asked, from the HTML and the headers given', () => {
    const wp =
      '<html><head><link rel="stylesheet" href="/wp-content/a.css"></head><body></body></html>';
    expect(read(wp, false, {}).stack).toEqual({ cms: 'wordpress' });
    expect(read(wp).stack).toBeNull();
    // A header alone: x-pingback names xmlrpc.php on WordPress.
    expect(
      read('<html><body></body></html>', false, { 'x-pingback': '/xmlrpc.php' }).stack,
    ).toEqual({ cms: 'wordpress' });
    expect(read('<html><body></body></html>', false, {}).stack).toEqual({ cms: 'custom' });
  });
});

/** Pages built from parts that vary what v1 reads: the meta name, its case and spacing, the tokens. */
const metaName = fc.constantFrom(
  'robots',
  'ROBOTS',
  ' googlebot ',
  'Bingbot',
  'description',
  'yandex',
);
const content = fc
  .array(fc.constantFrom('noindex', ' NOINDEX', 'none', 'follow', 'nofollow', 'noarchive', ''), {
    maxLength: 4,
  })
  .map((ts) => ts.join(','));
const prose = fc.array(fc.constantFrom('Words here.', 'More text', 'é and ü'), { maxLength: 30 });
const page = fc
  .record({
    metas: fc.array(fc.tuple(metaName, content), { maxLength: 3 }),
    article: prose,
    sidebar: prose,
  })
  .map(
    ({ metas, article, sidebar }) =>
      `<html><head>${metas.map(([n, c]) => `<meta name="${n}" content="${c}">`).join('')}</head>` +
      `<body><aside>${sidebar.join(' ')}</aside><main><p>${article.join(' ')}</p></main></body></html>`,
  );

describe("v1's classification signals", () => {
  it('match extractPage on generated pages: main-content length and meta noindex', () => {
    fc.assert(
      fc.property(page, (html) => {
        const v1 = extractPage(cheerio.load(html), URL_).classificationSignals;
        const r = read(html);
        expect(r.mainTextChars).toBe(v1.mainTextChars);
        expect(r.metaNoindex).toBe(v1.metaNoindex);
      }),
      { numRuns: 300 },
    );
  });

  it('read noindex from each name v1 reads, and not from others', () => {
    const meta = (name: string, c: string) =>
      read(`<html><head><meta name="${name}" content="${c}"></head><body></body></html>`)
        .metaNoindex;
    expect(meta('robots', 'index, noindex')).toBe(true);
    expect(meta('googlebot', 'none')).toBe(true);
    expect(meta('bingbot', 'NOINDEX')).toBe(true);
    expect(meta('description', 'noindex')).toBe(false);
    expect(meta('robots', 'nofollow')).toBe(false);
  });
});
