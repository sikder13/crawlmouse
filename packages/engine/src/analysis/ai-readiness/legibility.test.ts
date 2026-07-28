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
    expect(j).toEqual({ present: true, valid: true, types: ['Organization'], hasEntityType: true });
  });

  it('flags malformed JSON-LD as invalid but present', () => {
    const j = analyzeLegibility(
      cheerio.load('<head><script type="application/ld+json">{ not json }</script></head><body></body>'),
    ).jsonLd;
    expect(j.present).toBe(true);
    expect(j.valid).toBe(false);
  });

  it('reports absent JSON-LD', () => {
    expect(analyzeLegibility(cheerio.load('<body></body>')).jsonLd).toEqual({ present: false, valid: false, types: [], hasEntityType: false });
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

// ── CHECK BEFORE CAP + the walk bounds, each pinned INDEPENDENTLY ────────────────────────────────
// Every bound below previously had a test named for it that could not fail: the count cap was
// asserted against its own constant (vacuous under a constant bump), the depth test only asserted
// `not.toThrow()` (and `analyzeJsonLd` try/catches, so a stack overflow was swallowed), and the
// "shared budget" test asserted a ceiling the count cap already guaranteed. These assert BEHAVIOUR:
// a value that is present with the bound and absent without it, or vice versa.
describe('analyzeJsonLd — entity signal is decided BEFORE the storage cap', () => {
  const load = (json: string) =>
    analyzeLegibility(cheerio.load(`<head><script type="application/ld+json">${json}</script></head><body></body>`));

  it('recognises Organization even when it falls PAST the type cap', () => {
    // The blocking defect: the cap evicted Organization, `assemble` read the capped array, and a
    // homepage that declares an entity got a factually false `missing_entity_link` (score 94 → 91).
    const filler = Array.from({ length: 25 }, (_, i) => `{"@type":"Filler${i}"}`).join(',');
    const l = load(`{"@graph":[${filler},{"@type":"Organization"}]}`);
    expect(l.jsonLd.types).not.toContain('Organization'); // genuinely evicted from STORAGE…
    expect(l.jsonLd.types.length).toBe(JSON_LD_MAX_TYPES);
    expect(l.jsonLd.hasEntityType).toBe(true); // …and still recognised as a declared entity
  });

  it('recognises WebSite behind a hostile FIRST script block that exhausts the storage budget', () => {
    // The entity walk has its own budget precisely so a hostile page cannot starve the signal.
    const flood = Array.from({ length: 6000 }, (_, i) => `{"@type":"F${i}"}`).join(',');
    const html = `<head>
      <script type="application/ld+json">{"@graph":[${flood}]}</script>
      <script type="application/ld+json">{"@type":"WebSite"}</script>
      </head><body></body>`;
    expect(analyzeLegibility(cheerio.load(html)).jsonLd.hasEntityType).toBe(true);
  });

  it('recognises an entity nested deeper than the storage walk collects types from', () => {
    let json = '{"@type":"Organization"}';
    for (let i = 0; i < 8; i++) json = `{"@graph":[${json}]}`;
    expect(load(json).jsonLd.hasEntityType).toBe(true);
  });

  it('recognises an entity inside a @type ARRAY, and one whose sibling types are over-long', () => {
    expect(load(`{"@type":["${'X'.repeat(500)}","Organization"]}`).jsonLd.hasEntityType).toBe(true);
  });

  it('stays FALSE when no entity is declared (the signal is not just "any JSON-LD")', () => {
    expect(load('{"@graph":[{"@type":"Article"},{"@type":"BreadcrumbList"}]}').jsonLd.hasEntityType).toBe(false);
    expect(load('{"name":"no type at all"}').jsonLd.hasEntityType).toBe(false);
  });
});

describe('analyzeJsonLd — each walk bound pinned by BEHAVIOUR, not by its own constant', () => {
  const load = (json: string) =>
    analyzeLegibility(cheerio.load(`<head><script type="application/ld+json">${json}</script></head><body></body>`));

  it('the DEPTH bound stops collection — a type nested past it is absent, one inside it is present', () => {
    const nest = (levels: number) => {
      let json = '{"@type":"DeepMarker"}';
      for (let i = 0; i < levels; i++) json = `{"@graph":[${json}]}`;
      return json;
    };
    // Each @graph level costs 2 (object → array → object), so the reachable level count is DEPTH/2.
    expect(load(nest(4)).jsonLd.types).toContain('DeepMarker');
    expect(load(nest(40)).jsonLd.types).not.toContain('DeepMarker');
  });

  it('the NODE budget stops collection — a type behind more nodes than the budget is absent', () => {
    // Entries WITHOUT `@type` accumulate no types, so the count cap cannot end this walk: only the
    // node budget can. That is what makes this a test of the budget specifically.
    const filler = (n: number) => Array.from({ length: n }, (_, i) => `{"name":"n${i}"}`).join(',');
    expect(load(`{"@graph":[${filler(100)},{"@type":"LateMarker"}]}`).jsonLd.types).toContain('LateMarker');
    expect(load(`{"@graph":[${filler(20_000)},{"@type":"LateMarker"}]}`).jsonLd.types).not.toContain('LateMarker');
  });

  it('the node budget is SHARED across script blocks (a second block cannot restart it)', () => {
    const filler = Array.from({ length: 20_000 }, (_, i) => `{"name":"n${i}"}`).join(',');
    const html = `<head>
      <script type="application/ld+json">{"@graph":[${filler}]}</script>
      <script type="application/ld+json">{"@type":"SecondBlockMarker"}</script>
      </head><body></body>`;
    expect(analyzeLegibility(cheerio.load(html)).jsonLd.types).not.toContain('SecondBlockMarker');
  });

  it('a @type ARRAY is charged per element, so it cannot walk unbounded on one node charge', () => {
    const huge = Array.from({ length: 20_000 }, (_, i) => `"T${i}"`).join(',');
    const l = load(`{"@graph":[{"@type":[${huge}]},{"@type":"AfterTheArray"}]}`);
    expect(l.jsonLd.types.length).toBeLessThanOrEqual(JSON_LD_MAX_TYPES);
    expect(l.jsonLd.types).not.toContain('AfterTheArray');
  });

  it('DEDUPES ON THE RAW VALUE — distinct long types are not collapsed by truncation', () => {
    // Truncating before deduping collapsed 20 000 distinct type IRIs sharing a 100-char prefix into a
    // SINGLE entry, which also made a byte assertion pass for the wrong reason.
    const long = (i: number) => `${'T'.repeat(150)}${i}`;
    const l = load(`{"@graph":[{"@type":"${long(1)}"},{"@type":"${long(2)}"},{"@type":"${long(3)}"}]}`);
    expect(l.jsonLd.types.length).toBe(3);
  });
});
