import * as cheerio from 'cheerio';
import { describe, it, expect } from 'vitest';
import { extractMainContent } from './main-content.js';

describe('extractMainContent (§4.1)', () => {
  it('strips nav/header/footer/aside structural boilerplate from the main text', () => {
    const $ = cheerio.load(`<body>
      <header><a href="/">Home</a> SITE HEADER MENU</header>
      <nav><a href="/a">A</a><a href="/b">B</a> NAVIGATION BAR</nav>
      <main><h1>Real Article Title</h1><p>${'This is the genuine article body content. '.repeat(10)}</p></main>
      <aside>SIDEBAR PROMO WIDGET</aside>
      <footer>FOOTER LEGAL TEXT</footer>
    </body>`);
    const { text } = extractMainContent($);
    expect(text).toContain('Real Article Title');
    expect(text).toContain('genuine article body content');
    expect(text).not.toContain('NAVIGATION BAR');
    expect(text).not.toContain('FOOTER LEGAL TEXT');
    expect(text).not.toContain('SIDEBAR PROMO WIDGET');
    expect(text).not.toContain('SITE HEADER MENU');
  });

  it('keeps a hero block with class="banner" — no wildcard [class*=banner] stripping (A3)', () => {
    const $ = cheerio.load(
      `<body><div class="banner"><h1>Welcome Hero</h1><p>${'Compelling hero copy that is genuine content. '.repeat(6)}</p></div></body>`,
    );
    const { text } = extractMainContent($);
    expect(text).toContain('Welcome Hero');
    expect(text).toContain('Compelling hero copy');
  });

  it('strips a server-rendered CMP consent dialog by exact id', () => {
    const $ = cheerio.load(
      `<body><div id="onetrust-consent-sdk">WE USE COOKIES PLEASE ACCEPT ALL</div><main><p>${'Actual page content for the reader here. '.repeat(8)}</p></main></body>`,
    );
    const { text } = extractMainContent($);
    expect(text).not.toContain('WE USE COOKIES');
    expect(text).toContain('Actual page content');
  });

  it('drops a residual link-dense menu list but keeps prose that has a link', () => {
    const $ = cheerio.load(`<body><main>
      <p>Read our <a href="/pricing">pricing</a> page for full details about the plans we offer to every customer.</p>
      <ul><li><a href="/1">One</a></li><li><a href="/2">Two</a></li><li><a href="/3">Three</a></li><li><a href="/4">Four</a></li></ul>
    </main></body>`);
    const { text } = extractMainContent($);
    expect(text).toContain('Read our pricing page for full details');
    expect(text).not.toContain('One Two Three Four');
  });

  it('reports mainTextChars = the collapsed main-text length', () => {
    const $ = cheerio.load('<body><main><p>Hello   there    reader</p></main></body>');
    const { text, mainTextChars } = extractMainContent($);
    expect(text).toBe('Hello there reader');
    expect(mainTextChars).toBe('Hello there reader'.length);
  });

  it('does NOT mutate the shared $ — nav + link extraction must be unaffected (A1)', () => {
    const html = `<body><nav><a href="/a">A</a></nav><main><p>Body content that is long enough to matter to the reader.</p><a href="/x">X</a></main></body>`;
    const $ = cheerio.load(html);
    const navBefore = $('nav').length;
    const linksBefore = $('a[href]').length;
    extractMainContent($);
    expect($('nav').length).toBe(navBefore);
    expect($('a[href]').length).toBe(linksBefore);
  });

  it('is deterministic: identical HTML → identical output (A1)', () => {
    const html = `<body><main><h1>Deterministic</h1><p>${'Same content each run. '.repeat(12)}</p></main></body>`;
    expect(extractMainContent(cheerio.load(html))).toEqual(extractMainContent(cheerio.load(html)));
  });

  it('keeps a CARD GRID of content (each card is one link) — the wow excerpt is never blanked', () => {
    // A blog index / category page: 3 cards, each an <a> wrapping a heading + blurb. The container is
    // link-dense, but the cards ARE the content; density stripping must not empty the main text.
    const card = (n: number) =>
      `<div class="card"><a href="/post-${n}"><h2>Post ${n} Title Here</h2><p>A meaningful blurb describing post ${n} for the reader.</p></a></div>`;
    const $ = cheerio.load(`<body><main><div class="grid">${card(1)}${card(2)}${card(3)}</div></main></body>`);
    const { text, mainTextChars } = extractMainContent($);
    expect(mainTextChars).toBeGreaterThan(0);
    expect(text).toContain('Post 1 Title Here');
    expect(text).toContain('meaningful blurb describing post 3');
  });

  it('keeps a content <div>/<section> that has one link (the MIN_MENU_LINKS guard, not vacuous)', () => {
    const $ = cheerio.load(
      '<body><main><section><p>Our full pricing guide explains the plans in depth.</p> <a href="/pricing">See pricing</a></section></main></body>',
    );
    expect(extractMainContent($).text).toContain('Our full pricing guide explains the plans');
  });

  it('falls back to pre-density text if the density strip would empty the main content', () => {
    // A page that is ENTIRELY a link-dense list (all-links homepage). Stripping it must not yield "".
    const $ = cheerio.load(
      '<body><main><ul><li><a href="/a">Alpha news headline</a></li><li><a href="/b">Bravo news headline</a></li><li><a href="/c">Charlie news headline</a></li></ul></main></body>',
    );
    expect(extractMainContent($).mainTextChars).toBeGreaterThan(0);
  });

  it('bounds cost on a deeply-nested DOM (no O(depth^2) re-walk hang)', () => {
    const deep = `<body><main>${'<div>'.repeat(1000)}<p>innermost content that is real</p>${'</div>'.repeat(1000)}</main></body>`;
    const $ = cheerio.load(deep);
    const t0 = performance.now();
    const { text } = extractMainContent($);
    const ms = performance.now() - t0;
    expect(text).toContain('innermost content that is real');
    expect(ms).toBeLessThan(2000); // pre-fix the per-block .text() re-walk makes this ~12s
  });

  it('bounds cost on an interleaved-wrapper + width-amplified DOM (O(n), not O(n^2))', () => {
    // The shape that defeated a direct-children leaf heuristic: density blocks nested through a NON-density
    // <span> wrapper, amplified in width. Every ancestor used to re-walk the shared subtree → O(n^2).
    let inner = '<p>real innermost content here for the reader</p>';
    for (let i = 0; i < 250; i++) {
      const wide = Array.from({ length: 60 }, () => '<div><a href="/x">x</a></div>').join('');
      inner = `<div><span>${wide}${inner}</span></div>`;
    }
    const $ = cheerio.load(`<body><main>${inner}</main></body>`);
    const t0 = performance.now();
    const { text } = extractMainContent($);
    const ms = performance.now() - t0;
    expect(text).toContain('real innermost content here');
    expect(ms).toBeLessThan(2000); // O(n^2) on this ~30k-node DOM would be many seconds
  });

  it('strips a nested-<div> menu at the container level (not just leaves)', () => {
    const items = ['Home', 'About', 'Products', 'Pricing', 'Contact', 'Blog']
      .map((t) => `<div class="item"><a href="/${t}">${t}</a></div>`)
      .join('');
    const $ = cheerio.load(
      `<body><main><div class="menu">${items}</div><p>The genuine article body content written for real readers.</p></main></body>`,
    );
    const { text } = extractMainContent($);
    expect(text).toContain('genuine article body content');
    expect(text).not.toContain('Home About Products');
  });
});

describe('extractMainContent — the strip is O(n) in sibling width (CPU-DoS regression)', () => {
  it('a wide flat DOM is stripped in LINEAR time (CPU-DoS regression)', () => {
    // THE DEFECT: `$work.find(AI_STRUCTURAL_STRIP).remove()` — cheerio's `.find()` is QUADRATIC in a
    // node's direct-child count, and this ran on every crawled page, twice. Measured through the real
    // `extractPage` on a 1.8 MB page of 200 000 flat siblings: 176 894 ms, versus 579 ms with
    // extraction disabled. The cost is SYNCHRONOUS, so the crawl's wall-clock budget cannot preempt it
    // and Vercel's maxDuration kills the function — one page fails the entire audit. Not only an
    // attacker shape: a legitimate flat HTML index of 40 000 rows cost ~10 s per page.
    //
    // SIZING, deliberately modest. A timing assertion is the right instrument (the defect IS time
    // complexity), but an expensive fixture is not free: at 100 000 siblings this test starved a
    // CONCURRENT real-HTTP crawl-settlement test of CPU under `turbo run test`, turning a green suite
    // red for an unrelated reason — verified by skipping this one case. At 40 000 the quadratic path
    // still costs ~4 000 ms against a ~40 ms linear path, so a 1 500 ms threshold sits ~2.6x below the
    // regression and ~37x above the fixed cost, while the whole case costs ~0.15 s.
    //
    // The parse is hoisted OUT of the timed region: `cheerio.load` is linear and not what is under test.
    const html = `<html><body><p>hello</p>${'<h1></h1>'.repeat(40_000)}</body></html>`;
    const $ = cheerio.load(html);
    const t0 = performance.now();
    const out = extractMainContent($);
    const ms = performance.now() - t0;
    expect(out.mainTextChars).toBe(5); // 'hello' — the prose still survives the strip
    expect(ms, `wide-DOM strip took ${ms.toFixed(0)}ms (quadratic version: ~4 000ms here)`).toBeLessThan(1_500);
  }, 30_000);

  it('strips exactly what the SELECTOR CONSTANTS say, by tag, role, id and class', () => {
    // The O(n) walk derives its lookups from AI_STRUCTURAL_STRIP / CMP_STRIP_SELECTORS by parsing them,
    // so the constants stay the single source of truth. This pins that the derivation actually covers
    // all four selector FORMS — a hand-copied set would drift the day someone edits a constant.
    const cases: Array<[string, string]> = [
      ['<nav><a href="/x">NAVTEXT</a></nav>', 'NAVTEXT'],          // bare tag
      ['<footer>FOOTTEXT</footer>', 'FOOTTEXT'],
      ['<div role="navigation">ROLETEXT</div>', 'ROLETEXT'],        // [role="..."]
      ['<div role="banner">BANNERTEXT</div>', 'BANNERTEXT'],
      ['<div id="onetrust-consent-sdk">CMPTEXT</div>', 'CMPTEXT'],  // #id
      ['<div class="cc-window">CCTEXT</div>', 'CCTEXT'],            // .class
      ['<div class="foo cc-window bar">MULTITEXT</div>', 'MULTITEXT'], // class among several
    ];
    for (const [markup, marker] of cases) {
      const $ = cheerio.load(`<html><body><p>KEEPME</p>${markup}</body></html>`);
      const { text } = extractMainContent($);
      expect(text, `${marker} must be stripped`).not.toContain(marker);
      expect(text, 'prose must survive').toContain('KEEPME');
    }
    // …and a near-miss must NOT be stripped: substring/prefix matching would eat real content.
    const $keep = cheerio.load('<html><body><div class="cc-window-inner">KEEPTHIS</div></body></html>');
    expect(extractMainContent($keep).text).toContain('KEEPTHIS');
    const $keep2 = cheerio.load('<html><body><div role="navigation-ish">KEEPTHAT</div></body></html>');
    expect(extractMainContent($keep2).text).toContain('KEEPTHAT');
  });

  it('does NOT mutate the caller’s DOM — the clone was removed, so nothing may be spliced out', () => {
    // The old code cloned the body precisely so `.remove()` could not reach the caller's tree. The
    // clone is gone (it copied the whole subtree on every page); correctness now depends on the walk
    // being READ-ONLY, so that is asserted rather than assumed — other analyzers share this `$`.
    const $ = cheerio.load('<html><body><nav>N</nav><p>P</p><footer>F</footer></body></html>');
    extractMainContent($);
    expect($('nav').length, 'nav must still be in the DOM').toBe(1);
    expect($('footer').length, 'footer must still be in the DOM').toBe(1);
    expect($('body').text()).toBe('NPF');
  });
});
