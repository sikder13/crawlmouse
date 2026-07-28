import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { extractPage } from './extract.js';
import { AI_TITLE_MAX_BYTES, EXCERPT_MAX_BYTES, JSON_LD_MAX_TYPES, JSON_LD_TYPE_MAX_BYTES } from './analysis/ai-readiness/constants.js';

/**
 * THE RULE, asserted globally rather than field by field:
 *
 *   every string that leaves the engine for a database column must be well-formed UTF-16.
 *
 * Named-field tests are how four of these got missed — each new field was a new place to forget. This
 * walks whatever the engine actually produced.
 *
 * The check exploits well-formed `JSON.stringify` (ES2019): it emits astral characters literally and
 * escapes ONLY unpaired surrogates. So a `\uD800`-`\uDFFF` escape appearing in the serialization is
 * precisely the condition Postgres rejects with 22P02 — and the serialization is literally what
 * PostgREST sends, so this tests the bytes on the wire rather than a proxy for them.
 */
// D800–DFFF: the second nibble must span 8–F, NOT 8–B. An earlier version of this regex covered only
// the HIGH half (D800–DBFF) and silently ignored every lone LOW surrogate — half the defect class, and
// Postgres rejects both. It was caught by the "detector is honest" case at the bottom of this file,
// which is the whole reason that case exists.
const LONE_SURROGATE_ESCAPE = /\\u[dD][89abcdefABCDEF][0-9a-fA-F]{2}/;

export function serializedIsWellFormed(value: unknown): boolean {
  return !LONE_SURROGATE_ESCAPE.test(JSON.stringify(value) ?? '');
}

/** Second, independent check that reports WHERE — the regex says yes/no, this says which field. */
function offendingPaths(value: unknown, path = '$', out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (LONE_SURROGATE_ESCAPE.test(JSON.stringify(value))) out.push(path);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => offendingPaths(v, `${path}[${i}]`, out));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) offendingPaths(v, `${path}.${k}`, out);
  }
  return out;
}

/** Astral text at an ODD code-unit offset, so any even-numbered cap lands mid-pair. */
const oddAstral = (n: number) => `A${'\u{1F600}'.repeat(n)}`;

/**
 * A page built to break every cutter at once: unspaced astral prose (defeats the excerpt's word-boundary
 * escape hatch), astral title and anchor text, an astral URL, and JSON-LD carrying a lone surrogate that
 * NO amount of cut-safety would fix because it was never cut.
 */
const hostileHtml = (bodyChars = 4000) => `<html><head>
  <title>${oddAstral(300)}</title>
  <meta name="description" content="${oddAstral(200)}">
  <script type="application/ld+json">{"@type":"\ud800","@graph":[{"@type":"Bad\udfff"},{"@type":"${'T'.repeat(5000)}"}]}</script>
  </head><body><main><p>${oddAstral(bodyChars)}</p></main></body></html>`;

/**
 * SINGLE element, no sibling markup, no spaces. This matters more than it looks: an earlier version of
 * this fixture put the h1, p and anchors in separate elements, so whitespace collapse inserted a space,
 * `lastSpace` resolved at index 101, and the excerpt was 101 chars — 5% of the 2000 cap. The cut the
 * fixture was named for was never exercised, and reverting `buildExcerpt` to a bare `.slice()` left all
 * 541 engine tests green. A fixture that cannot reach the boundary cannot test the boundary.
 */
const assertReachesTheCut = (excerpt: string) => {
  // BYTES, not characters. The budget is UTF-8; on astral text 2000 bytes is ~500 characters, so a
  // character-length assertion here would fail on exactly the fixture it is meant to validate — the
  // same wrong-unit confusion the byte budgets exist to remove.
  expect(Buffer.byteLength(excerpt, 'utf8')).toBeGreaterThan(EXCERPT_MAX_BYTES - 10);
};

describe('RULE: every persisted crawled string is well-formed UTF-16', () => {
  it('a page engineered to break every cutter at once still serializes clean', () => {
    const out = extractPage(hostileHtml(), 'https://ex.com/', {});
    // Prove the fixture REACHES the truncation boundary before asserting anything about truncation.
    assertReachesTheCut(out.aiSignals!.excerpt);
    expect(offendingPaths(out)).toEqual([]);
    expect(serializedIsWellFormed(out)).toBe(true);
  });

  it('holds across a sweep of body lengths, so no single cap position is a lucky escape', () => {
    // The boundary only splits a pair at certain lengths; a single fixture can miss it by one unit.
    for (let n = 995; n <= 1015; n++) {
      const out = extractPage(hostileHtml(n), 'https://ex.com/', {});
      assertReachesTheCut(out.aiSignals!.excerpt);
      expect(serializedIsWellFormed(out), `body length ${n}`).toBe(true);
    }
  });

  it('holds for a full 500-page crawl result, the shape actually handed to the pages insert', () => {
    const pages = Array.from({ length: 500 }, (_, i) => {
      const p = extractPage(hostileHtml(900 + i), `https://ex.com/p${i}`, {});
      return { url: `https://ex.com/p${i}`, title: p.title ?? null, aiSignals: p.aiSignals, links: p.links };
    });
    expect(serializedIsWellFormed(pages)).toBe(true);
  });

  // NOTE — deliberately NOT asserted here: the SPEC 02 `fixes`-table artifacts (`sanitizeText`,
  // `sanitizeUrl`, `cleanInline`). Those cutters split surrogate pairs on the same audit-fatal path
  // (measured at caps 200/120/80/40 and 300), but they are LIVE pre-existing code outside this
  // branch's additive-SPEC-05 scope. Tracked as FU-7 with the probes; the shared helper they need
  // already exists, so each is a one-line change when that ticket is scheduled.

  it('PROPERTY: no crawled page can produce a malformed or over-cap aiSignals', () => {
    // Replaces a property that exercised the SPEC 02 sanitizers (now FU-7 scope) with one over the
    // path this branch owns: arbitrary hostile page text in, bounded well-formed signals out.
    // NOTE ON THE GENERATOR: it emits astral characters and surrogate-range NUMERIC CHARACTER
    // REFERENCES, but never a RAW lone surrogate code unit in the HTML. That is not a convenience —
    // a crawl cannot produce one: UTF-8 decoding turns invalid sequences into U+FFFD, and cheerio maps
    // surrogate-range NCRs to U+FFFD too (both verified). Generating one would test an unreachable
    // input, and it does in fact make `extractPage` itself throw, which is a property of the
    // pre-existing parse path rather than of anything this branch owns.
    //
    // The route by which a lone surrogate genuinely reaches persistence is `JSON.parse` accepting an
    // unpaired \uXXXX escape in JSON-LD, which is covered by the B2 cases in legibility.test.ts and by
    // the fixture below.
    // THE GENERATOR IS THE TEST. The previous version used fc.string({maxLength: 400}) and
    // body.repeat(20): measured 0 of 800 runs produced an excerpt over half the 2000-char cap, mean
    // length 112. Every assertion about truncation was therefore vacuous — the fixture-too-small
    // failure this file exists to prevent, wearing a costume. A property that samples only the
    // interior of a bound tests nothing about the bound.
    const unit = fc.oneof(
      { weight: 5, arbitrary: fc.constantFrom('\u{1F600}', '\u{10348}', '中', 'a', ' ', 'é') },
      { weight: 2, arbitrary: fc.constantFrom('&#xD800;', '&#xDFFF;', '&amp;', '&lt;') },
      { weight: 1, arbitrary: fc.constantFrom('<', '>', '&', '\"', '\n') },
    );
    const hostileTitle = fc.string({ unit, minLength: 250, maxLength: 600 });
    // Sized to STRADDLE the excerpt cut: enough units that the collapsed text always exceeds 2000,
    // with the length varying so the boundary lands at many different offsets.
    const hostileBody = fc.string({ unit, minLength: 1200, maxLength: 2600 });
    let reachedTheCut = 0;
    fc.assert(
      fc.property(hostileTitle, hostileBody, (title, body) => {
        const ld = '{"@type":"\ud800","@graph":[{"@type":"Bad\udfff"}]}';
        const html = `<html><head><title>${title}</title>` +
          `<script type="application/ld+json">${ld}</script></head>` +
          `<body><main><p>${body.repeat(3)}</p></main></body></html>`;
        const sig = extractPage(html, 'https://ex.com/', {}).aiSignals!;
        // Sanity is measured on the INPUT: whether the generated body actually exceeded the budget.
        // Measuring the OUTPUT conflates generator strength with the word-boundary trim, which can pull
        // the excerpt well below the cap for reasons that have nothing to do with the generator.
        if (Buffer.byteLength(body.repeat(3), 'utf8') > EXCERPT_MAX_BYTES) reachedTheCut += 1;
        expect(serializedIsWellFormed(sig)).toBe(true);
        if (sig.title != null) expect(Buffer.byteLength(sig.title, 'utf8')).toBeLessThanOrEqual(AI_TITLE_MAX_BYTES);
        expect(Buffer.byteLength(sig.excerpt, 'utf8')).toBeLessThanOrEqual(EXCERPT_MAX_BYTES);
        expect(sig.jsonLd.types.length).toBeLessThanOrEqual(JSON_LD_MAX_TYPES);
      }),
      { numRuns: 800 },
    );
    // GENERATOR SANITY. Without this, shrinking the generator (or a change to how main-content text is
    // collapsed) silently turns the property back into an interior-only sample and it keeps passing.
    // Every run must exceed the budget, or the property is sampling the interior of the bound again.
    expect(reachedTheCut, `only ${reachedTheCut}/800 generated bodies exceeded the budget`).toBe(800);
  });

  it('BOUNDARY CASES: excerpt lengths placed exactly on and around the cut', () => {
    // Explicit companions to the property: a pair straddling the boundary is only split at specific
    // offsets, and random sampling can miss the exact unit that matters.
    for (const n of [EXCERPT_MAX_BYTES - 2, EXCERPT_MAX_BYTES - 1, EXCERPT_MAX_BYTES, EXCERPT_MAX_BYTES + 1, EXCERPT_MAX_BYTES + 2]) {
      // Unspaced astral prose: no word boundary, so the raw cut is what runs.
      // Sized in BYTES: each emoji is 4 UTF-8 bytes, so n/4 emoji straddles an n-byte budget.
      const body = `A${'\u{1F600}'.repeat(Math.ceil(n / 4))}`;
      const html = `<html><head><title>T</title></head><body><main><p>${body}</p></main></body></html>`;
      const sig = extractPage(html, 'https://ex.com/', {}).aiSignals!;
      expect(serializedIsWellFormed(sig), `n=${n}`).toBe(true);
      expect(Buffer.byteLength(sig.excerpt, 'utf8'), `n=${n}`).toBeLessThanOrEqual(EXCERPT_MAX_BYTES);
    }
  });

  it('the RULE detector itself is honest — it fires on a known-bad value', () => {
    // A rule test that cannot fail is worse than none: it reads as proof while proving nothing.
    expect(serializedIsWellFormed({ excerpt: '\ud800' })).toBe(false);
    expect(offendingPaths({ a: { b: ['ok', '\udfff'] } })).toEqual(['$.a.b[1]']);
    // …and does NOT fire on legitimate astral text, which must survive untouched.
    expect(serializedIsWellFormed({ excerpt: '\u{1F600}\u{10348}' })).toBe(true);
    expect(offendingPaths({ ok: 'héllo 😀 中文' })).toEqual([]);
  });

  it('BYTE CEILING: aiSignals is bounded with EVERY string axis at worst case simultaneously', () => {
    // Count caps passed five times while the product stayed unbounded, every time because one string
    // axis was held at a convenient value. Every axis is maximal here at once: a 200 000-char title, a
    // 200 000-char body, 20 000 JSON-LD types each 5 000 chars long.
    const types = Array.from({ length: 20_000 }, (_, i) => `{"@type":"${'T'.repeat(5000)}${i}"}`).join(',');
    const html = `<html><head><title>${'X'.repeat(200_000)}</title>
      <script type="application/ld+json">{"@graph":[${types}]}</script>
      </head><body><main><p>${oddAstral(100_000)}</p></main></body></html>`;
    const sig = extractPage(html, 'https://ex.com/', {}).aiSignals!;
    const bytes = Buffer.byteLength(JSON.stringify(sig), 'utf8');
    expect(bytes, `aiSignals serialized to ${bytes} bytes`).toBeLessThan(12_000);
    // …and each axis individually, so no single one can become the dominant term unnoticed.
    expect(Buffer.byteLength(sig.title!, 'utf8')).toBeLessThanOrEqual(AI_TITLE_MAX_BYTES);
    expect(Buffer.byteLength(sig.excerpt, 'utf8')).toBeLessThanOrEqual(EXCERPT_MAX_BYTES);
    expect(sig.jsonLd.types.length).toBeLessThanOrEqual(JSON_LD_MAX_TYPES);
    sig.jsonLd.types.forEach((t) => expect(Buffer.byteLength(t, 'utf8')).toBeLessThanOrEqual(JSON_LD_TYPE_MAX_BYTES));
  });

  it('BYTE CEILING: a full PRO_PAGE_CAP crawl of worst-case pages stays bounded', () => {
    const html = `<html><head><title>${'X'.repeat(200_000)}</title></head><body><main><p>${oddAstral(100_000)}</p></main></body></html>`;
    const one = extractPage(html, 'https://ex.com/p', {}).aiSignals!;
    const perPage = Buffer.byteLength(JSON.stringify(one), 'utf8');
    // 2000 pages is PRO_PAGE_CAP. Asserted as an explicit product, so the ceiling is visible.
    expect(perPage * 2000, `${perPage} bytes/page x 2000`).toBeLessThan(25_000_000);
  });

  it('BYTE CEILING: a CJK page — 3 bytes per character, no attacker involved', () => {
    // The case the code-unit ceilings could not see: a plain Chinese-language page measured 4 547 code
    // units but 12 947 UTF-8 BYTES per row (2.85x), so a 500-page audit was 6.47 MB against a
    // documented 1.2 MB budget. With byte budgets the row is bounded in the unit the database uses.
    const cjk = '这是一个测试页面内容'.repeat(30_000);
    const html = `<html><head><title>${cjk}</title></head><body><main><p>${cjk}</p></main></body></html>`;
    const sig = extractPage(html, 'https://ex.com/', {}).aiSignals!;
    const bytes = Buffer.byteLength(JSON.stringify(sig), 'utf8');
    expect(bytes, `CJK aiSignals = ${bytes} bytes`).toBeLessThan(12_000);
    expect(Buffer.byteLength(sig.title!, 'utf8')).toBeLessThanOrEqual(AI_TITLE_MAX_BYTES);
    expect(Buffer.byteLength(sig.excerpt, 'utf8')).toBeLessThanOrEqual(EXCERPT_MAX_BYTES);
    // …and the whole-audit product at both caps, in real bytes.
    expect(bytes * 500, 'FREE cap').toBeLessThan(6_000_000);
    expect(bytes * 2000, 'PRO cap').toBeLessThan(24_000_000);
  });
});
