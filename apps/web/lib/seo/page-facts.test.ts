import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  hiddenFaqQuestions,
  internalPath,
  jaccard,
  pageFacts,
  shingles,
  skippedHeadings,
  typedNodes,
} from './page-facts';

const ORIGINS = ['https://crawlmouse.com', 'http://localhost:3100'];
const facts = (html: string, status = 200) =>
  pageFacts(new JSDOM(html).window.document, {
    url: 'http://localhost:3100/blog/x',
    status,
    origins: ORIGINS,
    xRobotsTag: null,
  });

const PAGE = `<!doctype html><html><head><title> A  title </title>
<meta name="description" content="One description.">
<meta name="description" content="Two.">
<link rel="canonical" href="https://crawlmouse.com/blog/x">
<meta name="robots" content="index, follow">
<meta property="og:image" content="/og.png"><meta property="og:image:alt" content="Card">
<script type="application/ld+json">{"@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Shown?","acceptedAnswer":{"@type":"Answer","text":"y"}},{"@type":"Question","name":"Hidden?","acceptedAnswer":{"@type":"Answer","text":"n"}}]}</script>
<script type="application/ld+json">{not json</script>
</head><body><header><a href="/">Home</a></header>
<main><h1>Heading one</h1><h2>Two</h2><h4>Four</h4><p>Shown? five words in main <script>var hidden=1</script></p>
<a href="https://crawlmouse.com/guides/?q=1#top">guides</a><a href="https://example.com/">out</a><a href="mailto:a@b.c">m</a>
<img src="/a.png"><img src="/b.png" alt=""></main></body></html>`;

describe('pageFacts', () => {
  const f = facts(PAGE);
  it('reads the head', () => {
    expect(f.title).toBe('A title');
    expect(f.descriptions).toEqual(['One description.', 'Two.']);
    expect(f.canonicals).toEqual(['https://crawlmouse.com/blog/x']);
    expect(f.robots).toEqual(['index, follow']);
    expect(f.social['og:image']).toEqual(['/og.png']);
    expect(f.social['og:image:alt']).toEqual(['Card']);
  });
  it('reads headings in order and finds the skip', () => {
    expect(f.h1).toEqual(['Heading one']);
    expect(f.headings.map((h) => h.level)).toEqual([1, 2, 4]);
    expect(skippedHeadings(f.headings)).toEqual([
      { from: { level: 2, text: 'Two' }, to: { level: 4, text: 'Four' } },
    ]);
  });
  it('keeps internal links as paths, drops other hosts and schemes', () => {
    expect(f.links).toEqual(['/', '/guides']);
  });
  it('counts words of <main> without script text, and images with no alt attribute', () => {
    expect(f.mainText).not.toContain('hidden');
    expect(f.wordCount).toBe(f.mainText.split(' ').length);
    expect(f.imagesWithoutAlt).toEqual(['/a.png']);
  });
  it('keeps a JSON-LD block that does not parse, as null', () => {
    expect(f.jsonLd.map((b) => b.data === null)).toEqual([false, true]);
  });
  it('names the FAQ questions the page does not show', () => {
    expect(hiddenFaqQuestions(f)).toEqual(['Hidden?']);
  });
  it('adds the X-Robots-Tag header to robots', () => {
    const d = new JSDOM('<html><body></body></html>').window.document;
    expect(
      pageFacts(d, {
        url: 'http://localhost:3100/',
        status: 200,
        origins: ORIGINS,
        xRobotsTag: 'noindex',
      }).robots,
    ).toEqual(['noindex']);
  });
});

describe('helpers', () => {
  it('internalPath normalises a trailing slash but keeps the root', () => {
    expect(internalPath('/', 'http://localhost:3100/a', ORIGINS)).toBe('/');
    expect(internalPath('/blog/', 'http://localhost:3100/a', ORIGINS)).toBe('/blog');
    expect(
      internalPath('https://www.crawlmouse.com/', 'http://localhost:3100/a', ORIGINS),
    ).toBeNull();
  });
  it('typedNodes walks arrays, nesting and @graph, and reads own keys only', () => {
    const v = JSON.parse('{"@graph":[{"@type":"A","x":{"@type":"B"}}],"__proto__":{"@type":"C"}}');
    expect(typedNodes(v).map((n) => n['@type'])).toEqual(['A', 'B', 'C']);
    expect(typedNodes({ toString: 1 })).toEqual([]);
  });
  it('jaccard of 5-gram shingles: 1 for the same text, 0 for disjoint, between for overlap', () => {
    const a = shingles('one two three four five six');
    expect(jaccard(a, a)).toBe(1);
    expect(jaccard(a, shingles('seven eight nine ten eleven'))).toBe(0);
    // independently: {1-5, 2-6} vs {2-6, 3-7} share one of three
    expect(jaccard(a, shingles('two three four five six seven'))).toBeCloseTo(1 / 3);
  });
});
