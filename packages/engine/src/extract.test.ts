import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as cheerio from 'cheerio';
import { extractPage } from './extract.js';

describe('extractPage', () => {
  it('extracts title and internal links', () => {
    const html = `
      <html><head><title>Home</title></head>
      <body>
        <a href="/about">About</a>
        <a href="https://example.com/products">Products</a>
        <a href="https://other.com/x">External</a>
        <a href="/contact" class="cta">Contact us</a>
      </body></html>`;
    const result = extractPage(html, 'https://example.com/');
    expect(result.title).toBe('Home');
    expect(result.links.map((l) => l.toUrl)).toEqual([
      'https://example.com/about',
      'https://example.com/products',
      'https://example.com/contact',
    ]);
    expect(result.links[0]!.anchorText).toBe('About');
  });

  it('skips empty hrefs, fragments-only, javascript:, mailto:', () => {
    const html = `<a href="#top">x</a><a href="javascript:void(0)">y</a><a href="mailto:a@b.com">z</a><a href="">empty</a>`;
    const result = extractPage(html, 'https://example.com/');
    expect(result.links).toEqual([]);
  });

  it('marks generic anchors', () => {
    const html = `<a href="/a">Click here</a><a href="/b">Real product page</a>`;
    const result = extractPage(html, 'https://example.com/');
    expect(result.links[0]!.isGenericAnchor).toBe(true);
    expect(result.links[1]!.isGenericAnchor).toBe(false);
  });

  it('handles relative URLs from non-root pages', () => {
    const html = `<a href="../sibling">x</a><a href="child">y</a>`;
    const result = extractPage(html, 'https://example.com/blog/post');
    expect(result.links.map((l) => l.toUrl)).toEqual([
      'https://example.com/sibling',
      'https://example.com/blog/child',
    ]);
  });

  // Perf: the crawler already holds a parsed cheerio root ($) for each fetched page,
  // so re-serializing it to HTML and re-parsing (cheerio.load again) is wasted CPU on
  // every request. extractPage must accept an already-parsed CheerioAPI and yield the
  // SAME result as parsing the equivalent HTML string — this is the hermetic guarantee
  // that the single-parse crawler path is behavior-identical to the old double-parse one.
  it('accepts an already-parsed cheerio root and matches the string-parse result', () => {
    const html = `
      <html><head><title>Home</title></head>
      <body>
        <a href="/about">About</a>
        <a href="https://example.com/products">Products</a>
        <a href="https://other.com/x">External</a>
        <a href="/contact" class="cta">Contact us</a>
      </body></html>`;
    const baseUrl = 'https://example.com/';
    const fromString = extractPage(html, baseUrl);
    const fromRoot = extractPage(cheerio.load(html), baseUrl);
    expect(fromRoot.title).toBe(fromString.title);
    expect(fromRoot.links).toEqual(fromString.links);
  });

  describe('rel=canonical (§2)', () => {
    it('returns a differing same-host canonical target', () => {
      const html = '<html><head><link rel="canonical" href="/main"></head><body></body></html>';
      expect(extractPage(html, 'https://example.com/variant?v=2').canonicalUrl).toBe('https://example.com/main');
    });

    it('ignores a self-canonical (nothing to consolidate)', () => {
      const html = '<html><head><link rel="canonical" href="https://example.com/p"></head><body></body></html>';
      expect(extractPage(html, 'https://example.com/p').canonicalUrl).toBeUndefined();
    });

    it('ignores a cross-host canonical (a page cannot reassign its identity to another site)', () => {
      const html = '<html><head><link rel="canonical" href="https://evil.com/x"></head><body></body></html>';
      expect(extractPage(html, 'https://example.com/p').canonicalUrl).toBeUndefined();
    });

    it('has no canonicalUrl when none is declared', () => {
      expect(extractPage('<html><head></head><body></body></html>', 'https://example.com/p').canonicalUrl).toBeUndefined();
    });
  });
});

describe('extractPage — SPEC 02 non-content link skipping (v2 opt)', () => {
  it('skips Jetpack/WordPress ?share=<platform> action links but keeps a non-platform "share" content param', () => {
    const html = `
      <a href="/post?share=facebook">fb</a>
      <a href="/post?share=jetpack-whatsapp">wa</a>
      <a href="/post?share=twitter&nb=1">tw</a>
      <a href="/articles?share=my-cool-article">content</a>
      <a href="/normal">normal</a>`;
    const urls = extractPage(html, 'https://example.com/', { excludeNonContentLinks: true }).links.map((l) => l.toUrl);
    expect(urls.some((u) => u.includes('share=facebook'))).toBe(false);
    expect(urls.some((u) => u.includes('share=jetpack-whatsapp'))).toBe(false);
    expect(urls.some((u) => u.includes('share=twitter'))).toBe(false);
    expect(urls.some((u) => u.includes('share=my-cool-article'))).toBe(true); // non-platform value = real content, kept
    expect(urls.some((u) => u.endsWith('/normal'))).toBe(true);
  });

  it('skips media/binary file links + WordPress uploads, but keeps real content pages (incl. .html)', () => {
    const html = `
      <a href="/photo.jpg">img</a>
      <a href="/doc.PDF">pdf</a>
      <a href="/bundle.min.js">js</a>
      <a href="/wp-content/uploads/2020/06/pic.jpg?w=600">wp upload</a>
      <a href="/about">about</a>
      <a href="/2020/06/my-post">post</a>
      <a href="/products/widget.html">html page</a>`;
    const urls = extractPage(html, 'https://example.com/', { excludeNonContentLinks: true }).links.map((l) => l.toUrl);
    expect(urls.some((u) => u.includes('photo.jpg'))).toBe(false);
    expect(urls.some((u) => u.toLowerCase().includes('doc.pdf'))).toBe(false); // case-insensitive extension
    expect(urls.some((u) => u.includes('bundle.min.js'))).toBe(false);
    expect(urls.some((u) => u.includes('/wp-content/uploads/'))).toBe(false);
    expect(urls.some((u) => u.endsWith('/about'))).toBe(true); // no extension = content
    expect(urls.some((u) => u.includes('/my-post'))).toBe(true);
    expect(urls.some((u) => u.includes('widget.html'))).toBe(true); // .html IS a content page, kept
  });

  it('keeps share + media links when the opt is OFF (v1 byte-identical)', () => {
    const urls = extractPage('<a href="/post?share=facebook">fb</a><a href="/x.jpg">i</a>', 'https://example.com/').links.map((l) => l.toUrl);
    expect(urls.some((u) => u.includes('share=facebook'))).toBe(true);
    expect(urls.some((u) => u.includes('x.jpg'))).toBe(true);
  });

  describe('AI signals (SPEC 05 §4 — additive, computed in the single parse)', () => {
    it('attaches PageAiSignals to the extracted page', () => {
      const html =
        '<html><head><title>Doc</title></head><body><main><h1>Guide</h1><p>' +
        'A readable page with plenty of genuine prose an AI crawler can read without any JavaScript. '.repeat(4) +
        '</p></main></body></html>';
      const page = extractPage(html, 'https://example.com/');
      expect(page.aiSignals).toBeDefined();
      expect(page.aiSignals?.pageClass).toBe('readable');
      expect(page.aiSignals?.hasTitle).toBe(true);
      expect(page.aiSignals?.mainTextChars).toBeGreaterThanOrEqual(200);
    });

    it('does NOT change the title/link extraction (additive only)', () => {
      const html = '<html><head><title>Home</title></head><body><nav><a href="/about">About</a></nav></body></html>';
      const page = extractPage(html, 'https://example.com/');
      expect(page.title).toBe('Home');
      expect(page.links.map((l) => l.toUrl)).toEqual(['https://example.com/about']);
    });

    it('runs on a crawler-passed cheerio root without a second load (A1)', () => {
      const $ = cheerio.load('<html><head><title>T</title></head><body><main><p>short</p></main></body></html>');
      const linksBefore = $('a[href]').length;
      const page = extractPage($, 'https://example.com/');
      expect(page.aiSignals?.pageClass).toBe('thin'); // low text, no CSR evidence
      expect($('a[href]').length).toBe(linksBefore); // shared $ unmutated
    });

    it('the ai-readiness module never re-parses (no cheerio.load; single-parse invariant, A1)', () => {
      // Structural guard: `cheerio.load` cannot be spied on (frozen ESM namespace), so assert the
      // invariant at the source — the extraction operates on the passed `$` and must never re-serialize
      // + re-load it (the double-parse the crawler deliberately eliminated). Each module imports cheerio
      // TYPE-ONLY, making a runtime load() impossible.
      const dir = new URL('./analysis/ai-readiness/', import.meta.url);
      for (const f of ['main-content.ts', 'classify.ts', 'legibility.ts', 'page-signals.ts']) {
        const src = readFileSync(new URL(f, dir), 'utf8');
        expect(src).not.toMatch(/cheerio\.load\s*\(/); // no re-parse CALL (a doc-comment mention is fine)
        if (src.includes("from 'cheerio'")) expect(src).toMatch(/import type \* as cheerio from 'cheerio'/);
      }
    });

    it('grade-bearing outputs (title/links) are byte-identical with AI_READINESS_EXTRACTION on vs off', () => {
      // The load-bearing invariant: toggling the kill-switch changes ONLY whether aiSignals is populated;
      // the title + links that feed the grade must be identical, so the grade can never move with it.
      const html =
        '<html><head><title>Guide</title></head><body><nav><a href="/a">A</a></nav><main><h1>Post</h1><p>' +
        'Readable prose with a fair amount of genuine content for a crawler to read here. '.repeat(4) +
        '</p><a href="/b">B</a></main></body></html>';
      const prev = process.env.AI_READINESS_EXTRACTION;
      try {
        delete process.env.AI_READINESS_EXTRACTION; // default ON
        const on = extractPage(html, 'https://example.com/');
        process.env.AI_READINESS_EXTRACTION = '0'; // OFF
        const off = extractPage(html, 'https://example.com/');
        expect(on.aiSignals).toBeDefined();
        expect(off.aiSignals).toBeUndefined();
        expect(off.title).toBe(on.title);
        expect(off.links).toEqual(on.links);
        expect(off.canonicalUrl).toBe(on.canonicalUrl);
      } finally {
        if (prev === undefined) delete process.env.AI_READINESS_EXTRACTION;
        else process.env.AI_READINESS_EXTRACTION = prev;
      }
    });

    it('never throws or drops links on a pathological deeply-nested DOM (crash-safe; §12)', () => {
      // An attacker-controlled page can nest ~thousands deep; the AI extraction must degrade to no
      // signals rather than throw a RangeError out of extractPage (which would drop the page + its
      // links from the graph and could drift the grade). Title/links are extracted regardless.
      const deep = `<html><head><title>Deep</title></head><body><a href="/reachme">Reach</a>${'<div>'.repeat(5000)}x${'</div>'.repeat(5000)}</body></html>`;
      let page!: ReturnType<typeof extractPage>;
      expect(() => {
        page = extractPage(deep, 'https://example.com/');
      }).not.toThrow();
      expect(page.title).toBe('Deep');
      expect(page.links.map((l) => l.toUrl)).toContain('https://example.com/reachme');
      // aiSignals may be undefined (degraded) — the point is extractPage did not throw.
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5.2 / §5.4 — THE PARSE-TIME CLASSIFICATION SIGNALS, pinned END TO END.
//
// ADDED AFTER THREE SURVIVING MUTATIONS. `readMetaNoindex() -> false`, the meta-name set narrowed to
// `robots` alone, and `simhash -> null` each passed all 838 engine tests. Acceptance rows B4
// (Classification) and B5 (SimHash) were MET on the strength of `classify-pages.test.ts` and
// `simhash.test.ts` — the two PURE halves. The signals those halves consume are produced HERE, and
// nothing observed that production. Both are grade-changing: a noindex page re-enters the gradeable
// population, and a null simhash disables near-duplicate collapsing.
// ─────────────────────────────────────────────────────────────────────────────
describe('extractPage produces the classification signals classify-pages consumes', () => {
  const html = (head: string, body = '<p>' + 'word '.repeat(200) + '</p>') =>
    `<html><head><title>t</title>${head}</head><body><main>${body}</main></body></html>`;

  it('reads meta noindex — and from googlebot/bingbot too, not just robots', () => {
    for (const name of ['robots', 'googlebot', 'bingbot']) {
      const p = extractPage(html(`<meta name="${name}" content="noindex,follow">`), 'https://x.test/a');
      expect(p.classificationSignals.metaNoindex, `${name} must be honoured`).toBe(true);
    }
  });

  it('honours `none` as well as `noindex`, and ignores an indexable page', () => {
    expect(extractPage(html('<meta name="robots" content="none">'), 'https://x.test/a')
      .classificationSignals.metaNoindex).toBe(true);
    expect(extractPage(html('<meta name="robots" content="index,follow">'), 'https://x.test/a')
      .classificationSignals.metaNoindex).toBe(false);
    expect(extractPage(html(''), 'https://x.test/a').classificationSignals.metaNoindex).toBe(false);
  });

  it('produces a simhash for real content, and null for none — the §5.4 dedup input', () => {
    const withText = extractPage(html(''), 'https://x.test/a');
    expect(withText.classificationSignals.simhash).toMatch(/^[0-9a-f]+$/);
    const empty = extractPage('<html><head><title>t</title></head><body></body></html>', 'https://x.test/b');
    expect(empty.classificationSignals.simhash).toBeNull();
  });

  it('gives near-identical pages the same simhash and different pages different ones', () => {
    const a = extractPage(html('', '<p>' + 'alpha beta gamma '.repeat(80) + '</p>'), 'https://x.test/a');
    const b = extractPage(html('', '<p>' + 'alpha beta gamma '.repeat(80) + ' delta</p>'), 'https://x.test/b');
    const c = extractPage(html('', '<p>' + 'zulu yankee xray '.repeat(80) + '</p>'), 'https://x.test/c');
    expect(a.classificationSignals.simhash).toBe(b.classificationSignals.simhash);
    expect(a.classificationSignals.simhash).not.toBe(c.classificationSignals.simhash);
  });
});
