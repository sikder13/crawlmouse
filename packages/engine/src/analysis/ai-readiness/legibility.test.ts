import * as cheerio from 'cheerio';
import { describe, it, expect } from 'vitest';
import { analyzeLegibility, detectFrameworkMarker } from './legibility.js';
import { JSON_LD_MAX_TYPES, JSON_LD_TYPE_MAX_CHARS } from './constants.js';

describe('analyzeLegibility (§5)', () => {
  it('detects title + meta-description presence', () => {
    const l = analyzeLegibility(
      cheerio.load('<head><title>Hi</title><meta name="description" content="A page"></head><body></body>'),
    );
    expect(l.hasTitle).toBe(true);
    expect(l.hasMetaDescription).toBe(true);
  });

  it('treats a missing title and a whitespace-only description as absent', () => {
    const l = analyzeLegibility(cheerio.load('<head><meta name="description" content="   "></head><body></body>'));
    expect(l.hasTitle).toBe(false);
    expect(l.hasMetaDescription).toBe(false);
  });

  it('counts H1s', () => {
    expect(analyzeLegibility(cheerio.load('<body><h1>a</h1><h1>b</h1></body>')).h1Count).toBe(2);
  });

  it('flags a skipped heading level (h1 then h3)', () => {
    expect(analyzeLegibility(cheerio.load('<body><h1>a</h1><h3>c</h3></body>')).headingLevelsSkipped).toBe(true);
  });

  it('does not flag a well-ordered outline', () => {
    expect(
      analyzeLegibility(cheerio.load('<body><h1>a</h1><h2>b</h2><h3>c</h3><h2>d</h2></body>')).headingLevelsSkipped,
    ).toBe(false);
  });

  it('detects a main landmark (<main>, <article>, or role=main)', () => {
    expect(analyzeLegibility(cheerio.load('<body><main>x</main></body>')).hasMainLandmark).toBe(true);
    expect(analyzeLegibility(cheerio.load('<body><div role="main">x</div></body>')).hasMainLandmark).toBe(true);
    expect(analyzeLegibility(cheerio.load('<body><div>x</div></body>')).hasMainLandmark).toBe(false);
  });

  it('parses valid JSON-LD and collects @type', () => {
    const j = analyzeLegibility(
      cheerio.load(
        '<head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"X"}</script></head><body></body>',
      ),
    ).jsonLd;
    expect(j).toEqual({ present: true, valid: true, types: ['Organization'] });
  });

  it('flags malformed JSON-LD as invalid but present', () => {
    const j = analyzeLegibility(
      cheerio.load('<head><script type="application/ld+json">{ not json }</script></head><body></body>'),
    ).jsonLd;
    expect(j.present).toBe(true);
    expect(j.valid).toBe(false);
  });

  it('reports absent JSON-LD', () => {
    expect(analyzeLegibility(cheerio.load('<body></body>')).jsonLd).toEqual({ present: false, valid: false, types: [] });
  });

  it('collects @type from an @graph array (deduped)', () => {
    const j = analyzeLegibility(
      cheerio.load(
        '<head><script type="application/ld+json">{"@graph":[{"@type":"WebSite"},{"@type":["Organization","LocalBusiness"]}]}</script></head><body></body>',
      ),
    ).jsonLd;
    expect(j.valid).toBe(true);
    expect([...j.types].sort()).toEqual(['LocalBusiness', 'Organization', 'WebSite']);
  });

  it('collects @type in deterministic FIRST-OCCURRENCE order (not sorted), deduped', () => {
    const j = analyzeLegibility(
      cheerio.load(
        '<head><script type="application/ld+json">{"@graph":[{"@type":"WebSite"},{"@type":"Organization"},{"@type":"WebSite"}]}</script></head><body></body>',
      ),
    ).jsonLd;
    expect(j.types).toEqual(['WebSite', 'Organization']); // document order preserved, dup dropped — NOT ['Organization','WebSite']
  });
});

describe('detectFrameworkMarker (§4 — explanation, never a verdict)', () => {
  it('nextjs via __NEXT_DATA__', () => {
    expect(
      detectFrameworkMarker(cheerio.load('<body><div id="__next"></div><script id="__NEXT_DATA__">{}</script></body>')),
    ).toBe('nextjs');
  });
  it('nuxt via #__nuxt', () => {
    expect(detectFrameworkMarker(cheerio.load('<body><div id="__nuxt"></div></body>'))).toBe('nuxt');
  });
  it('gatsby via #___gatsby', () => {
    expect(detectFrameworkMarker(cheerio.load('<body><div id="___gatsby"></div></body>'))).toBe('gatsby');
  });
  it('react via [data-reactroot]', () => {
    expect(detectFrameworkMarker(cheerio.load('<body><div data-reactroot></div></body>'))).toBe('react');
  });
  it('null for a plain static page', () => {
    expect(detectFrameworkMarker(cheerio.load('<body><main><p>hi</p></main></body>'))).toBe(null);
  });
});

// ── §5 JSON-LD bounds (B2/B3) ────────────────────────────────────────────────────
// Fixtures are WORST-case on purpose. The defect that shipped here survived a green suite because
// every existing JSON-LD fixture was a handful of short, well-formed types — too small to exercise
// either the size axis or the surrogate axis of the property the code is responsible for.
describe('analyzeJsonLd — bounds and UTF-16 well-formedness', () => {
  const load = (json: string) =>
    analyzeLegibility(cheerio.load(`<head><script type="application/ld+json">${json}</script></head><body></body>`));

  const hasLone = (s: string): boolean => {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const n = s.charCodeAt(i + 1);
        if (!(n >= 0xdc00 && n <= 0xdfff)) return true;
        i++;
      } else if (c >= 0xdc00 && c <= 0xdfff) return true;
    }
    return false;
  };

  it('B2: a lone surrogate arriving through JSON.parse is repaired, not persisted', () => {
    // 40 bytes of valid JSON. JSON.parse ACCEPTS the unpaired escape; Postgres does not, and the
    // failed pages insert fails the whole audit. No truncation is involved, so a cut-safe helper
    // alone would not catch this.
    const l = load('{"@type":"\\ud800"}');
    expect(l.jsonLd.types).toHaveLength(1);
    expect(hasLone(l.jsonLd.types[0]!)).toBe(false);
  });

  it('B2: a lone surrogate INSIDE an @type array entry is repaired too', () => {
    const l = load('{"@type":["Article","Bad\\udc00End"]}');
    expect(l.jsonLd.types.every((t) => !hasLone(t))).toBe(true);
  });

  it('B3: caps the TYPE COUNT — 20 000 @graph entries yield at most JSON_LD_MAX_TYPES', () => {
    const graph = Array.from({ length: 20_000 }, (_, i) => `{"@type":"T${i}"}`).join(',');
    const l = load(`{"@graph":[${graph}]}`);
    expect(l.jsonLd.types.length).toBeLessThanOrEqual(JSON_LD_MAX_TYPES);
    expect(l.jsonLd.present).toBe(true);
    expect(l.jsonLd.valid).toBe(true);
  });

  it('B3: caps PER-ITEM LENGTH — a single megabyte-long @type cannot ride into jsonb', () => {
    const l = load(`{"@type":"${'T'.repeat(1_000_000)}"}`);
    expect(l.jsonLd.types[0]!.length).toBeLessThanOrEqual(JSON_LD_TYPE_MAX_CHARS);
  });

  it('B3: the SERIALIZED signal stays small on the worst case that measured 1.15 MB', () => {
    // The bound that actually matters is bytes-in-the-insert-body, so assert on the serialization
    // rather than on the field — count and length caps could both hold while the product blew up.
    const graph = Array.from({ length: 20_000 }, (_, i) => `{"@type":"${'T'.repeat(200)}${i}"}`).join(',');
    const l = load(`{"@graph":[${graph}]}`);
    expect(JSON.stringify(l.jsonLd).length).toBeLessThan(4_000);
  });

  it('B3: deep @graph nesting terminates instead of recursing without bound', () => {
    let json = '{"@type":"Leaf"}';
    for (let i = 0; i < 5_000; i++) json = `{"@graph":[${json}]}`;
    expect(() => load(json)).not.toThrow();
  });

  it('the node budget is SHARED across script blocks, so N blocks cannot multiply the ceiling', () => {
    const block = `{"@graph":[${Array.from({ length: 3_000 }, (_, i) => `{"@type":"A${i}"}`).join(',')}]}`;
    const html = `<head>${Array.from({ length: 20 }, () => `<script type="application/ld+json">${block}</script>`).join('')}</head><body></body>`;
    const l = analyzeLegibility(cheerio.load(html));
    expect(l.jsonLd.types.length).toBeLessThanOrEqual(JSON_LD_MAX_TYPES);
  });

  it('R1: deterministic — identical input yields byte-identical types', () => {
    const json = '{"@graph":[{"@type":"Article"},{"@type":["WebPage","Thing"]},{"@type":"Article"}]}';
    expect(JSON.stringify(load(json).jsonLd)).toBe(JSON.stringify(load(json).jsonLd));
  });

  it('ordinary structured data is UNCHANGED — first-occurrence order, deduped', () => {
    const l = load('{"@graph":[{"@type":"Organization"},{"@type":["WebSite","Thing"]},{"@type":"Organization"}]}');
    expect(l.jsonLd.types).toEqual(['Organization', 'WebSite', 'Thing']);
  });
});
