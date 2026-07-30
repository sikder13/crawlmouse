import * as cheerio from 'cheerio';
import { describe, it, expect } from 'vitest';
import { extractMainContent } from './main-content.js';
import { AI_STRUCTURAL_STRIP, CMP_STRIP_SELECTORS } from './constants.js';

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
    expect(text).not.toContain('OneTwoThreeFour'); // NOT 'One Two Three Four' — the fixture
    // concatenates <li> with no whitespace, so the spaced form never appears and the assertion
    // could not fail. Two mutants that fully disable the menu drop survived because of it.
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
    expect(ms).toBeLessThan(20_000); // generous by 10x: this guards a hang, not a budget —
    // a 2 000 ms bound in this file flaked under `turbo run test` parallelism (measured 2 846 ms
    // on correct code), and a timing assertion tight enough to flake trains people to ignore red. // pre-fix the per-block .text() re-walk makes this ~12s
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
    expect(ms).toBeLessThan(20_000); // generous by 10x: this guards a hang, not a budget —
    // a 2 000 ms bound in this file flaked under `turbo run test` parallelism (measured 2 846 ms
    // on correct code), and a timing assertion tight enough to flake trains people to ignore red. // O(n^2) on this ~30k-node DOM would be many seconds
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
    expect(text).not.toContain('HomeAboutProducts'); // spaced form is unreachable — see above
  });
});

describe('extractMainContent — strip equivalence and complexity', () => {
  /**
   * THE ORACLE: the exact pre-refactor implementation. The strip used to be
   * `$('body').clone().find(SEL).remove()`, and that CSS engine is the definition of correct — so it is
   * the thing to diff against, not a hand-written expectation.
   *
   * This exists because a hand-rolled matcher replaced that engine and no test could tell the two apart:
   * restoring the ENTIRE old implementation left 15 of 16 cases green. The matcher was wrong —
   * domhandler types `<script>` as `'script'` and `<style>` as `'style'`, not `'tag'`, so those two were
   * never stripped and inline script bodies became "main content" (on a Next.js shell: `js_blind` ->
   * `readable`, AI score 33 `at_risk` -> 89 `ready`). The matcher is gone; cheerio matches again, and
   * this diffs the survivor against the original.
   */
  const oracle = (html: string): string => {
    const $ = cheerio.load(html);
    const $work = $('body').clone();
    $work.find(AI_STRUCTURAL_STRIP).remove();
    $work.find(CMP_STRIP_SELECTORS).remove();
    return $work.text().replace(/\s+/g, ' ').trim();
  };
  const agree = (label: string, html: string) =>
    expect(extractMainContent(cheerio.load(html)).text, label).toBe(oracle(html));

  /** ITERATED from the constants, never sampled — the previous test hand-picked 2 of 9 tags, and the
   *  two it skipped were the two that were broken. */
  const SELECTORS = [...AI_STRUCTURAL_STRIP.split(','), ...CMP_STRIP_SELECTORS.split(',')].map((x) => x.trim());
  const fixtureFor = (sel: string): string => {
    if (sel.startsWith('#')) return `<div id="${sel.slice(1)}">STRIPME</div>`;
    if (sel.startsWith('.')) return `<div class="pre ${sel.slice(1)} post">STRIPME</div>`;
    const role = /^\[role="([^"]+)"\]$/.exec(sel);
    if (role) return `<div role="${role[1]}">STRIPME</div>`;
    return `<${sel}>STRIPME</${sel}>`;
  };
  /**
   * A fixture that does not MATCH its selector makes the whole case a silent no-op: `agree()` then
   * compares two identical un-stripped strings and passes. `fixtureFor` handles four selector shapes;
   * anything else (a compound like `div.ad-slot`, an attribute selector, a combinator) falls through to
   * `<div.ad-slot>STRIPME</div.ad-slot>`, which matches nothing. So every fixture proves itself first.
   */
  const assertFixtureMatches = (sel: string) => {
    const $ = cheerio.load(`<html><body>${fixtureFor(sel)}</body></html>`);
    expect($(sel).length, `fixtureFor(${JSON.stringify(sel)}) built a NON-MATCHING fixture — this case would pass vacuously`).toBe(1);
  };

  it('matches the CSS-engine oracle for EVERY selector in both constants', () => {
    expect(SELECTORS.length, 'sanity: the constants parsed').toBeGreaterThan(14);
    for (const sel of SELECTORS) {
      assertFixtureMatches(sel);
      agree(`positive ${sel}`, `<html><body><p>KEEP</p>${fixtureFor(sel)}</body></html>`);
      agree(`nested ${sel}`, `<html><body><main><p>KEEP</p><div>${fixtureFor(sel)}</div></main></body></html>`);
      agree(`uppercase ${sel}`, `<html><body><p>KEEP</p>${fixtureFor(sel).toUpperCase()}</body></html>`);
      agree(`sole content ${sel}`, `<html><body>${fixtureFor(sel)}</body></html>`);
      if (sel.startsWith('#')) agree(`id near-miss ${sel}`, `<html><body><div id="${sel.slice(1)}-x">KEEPME</div></body></html>`);
      if (sel.startsWith('.')) agree(`class near-miss ${sel}`, `<html><body><div class="${sel.slice(1)}-x">KEEPME</div></body></html>`);
    }
  });

  it('the CONSTANTS still contain every selector the AI signal depends on', () => {
    // THE HOLE THIS CLOSES. Everything above iterates the constants — including the oracle, which calls
    // `.find(AI_STRUCTURAL_STRIP)`. So deleting a selector removes it from the implementation, from the
    // oracle AND from the iteration: all three agree that nothing should be stripped, and the entire
    // differential suite stays green. Verified: deleting `script` from the constant leaves all 600
    // engine tests passing while inline `<script>` bodies become "main content" — which is EXACTLY the
    // defect this round exists to close, reproduced by a one-word edit.
    //
    // A differential test can prove the implementation agrees with cheerio. It cannot prove the
    // constants are right. That needs a literal expectation, so here is one.
    const structural = AI_STRUCTURAL_STRIP.split(',').map((x) => x.trim());
    for (const required of ['nav', 'footer', 'header', 'aside', 'script', 'style', 'noscript', 'template', 'svg',
                            '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]']) {
      expect(structural, `AI_STRUCTURAL_STRIP must strip ${required}`).toContain(required);
    }
    const cmp = CMP_STRIP_SELECTORS.split(',').map((x) => x.trim());
    for (const required of ['#onetrust-consent-sdk', '#CybotCookiebotDialog', '.cc-window',
                            '#usercentrics-root', '#cookiescript_injected', '#cookie-law-info-bar']) {
      expect(cmp, `CMP_STRIP_SELECTORS must strip ${required}`).toContain(required);
    }
  });

  it('BEHAVIOUR, asserted literally rather than through the oracle: every selector strips', () => {
    // Same reasoning as above, one level down: assert the OUTCOME against a literal, so a constant
    // deletion fails here even though the oracle would agree with it.
    for (const sel of SELECTORS) {
      assertFixtureMatches(sel);
      const text = extractMainContent(cheerio.load(`<html><body><p>KEEP</p>${fixtureFor(sel)}</body></html>`)).text;
      expect(text, `${sel} must be stripped`).toBe('KEEP');
    }
  });

  it('matches the oracle on the shapes that broke the hand-rolled matcher', () => {
    // script/style: domhandler types them as 'script'/'style', not 'tag'.
    agree('inline script', '<html><body><p>KEEP</p><script>var SECRET=1;</script></body></html>');
    agree('inline style', '<html><body><style>.a{color:red}</style><p>KEEP</p></body></html>');
    agree('next shell', '<html><body><div id="__next"></div><script id="__NEXT_DATA__">{"props":{"x":1}}</script></body></html>');
    // <body> itself carrying a strip attribute: `.find()` searches DESCENDANTS ONLY and can never strip
    // the root, so neither may we — the hand-rolled version did, blanking the whole page.
    for (const attr of ['role="banner"', 'role="navigation"', 'role="contentinfo"', 'class="cc-window"', 'id="usercentrics-root"'])
      agree(`body ${attr}`, `<html><body ${attr}><p>PROSE SURVIVES</p></body></html>`);
  });

  it('a stripped direct child contributes NO link count to the density decision', () => {
    // Pass 1 must skip stripped children for stats, not just for text. Without it a strip-attributed
    // <a> still increments `linkCount`, which can push a block past MIN_MENU_LINKS and get the whole
    // block dropped as a menu. This line survived mutation until this case existed.
    const html =
      '<html><body><ul><li><a href="/a">Home</a></li><li><a href="/b">About</a></li>' +
      '<li><a role="banner" href="/c">X</a></li></ul><p>Other paragraph.</p></body></html>';
    agree('strip-attributed anchor in a link list', html);
    expect(extractMainContent(cheerio.load(html)).text).toContain('Home');
  });

  it('COMPLEXITY: cost tracks node count, not sibling WIDTH', () => {
    // A wall-clock threshold was tried and was wrong: the fixed code measured 13 062 ms under
    // contention while the quadratic version measured 6 699 ms — the populations overlap, so the bound
    // discriminated machine state rather than time complexity, and it went red on correct code 1 run in 7.
    //
    // This compares two shapes with the SAME node count instead: flat siblings vs 100-per-parent. The
    // ratio is self-relative, so machine speed cancels. Measured: quadratic 21.6x, linear 1.1x.
    const N = 20_000;
    const flat = `<html><body><p>hi</p>${'<h1>x</h1>'.repeat(N)}</body></html>`;
    const nested = `<html><body><p>hi</p>${Array.from({ length: N / 100 }, () => `<div>${'<h1>x</h1>'.repeat(100)}</div>`).join('')}</body></html>`;
    const $flat = cheerio.load(flat);
    const $nested = cheerio.load(nested);
    let t = performance.now(); extractMainContent($flat); const flatMs = performance.now() - t;
    t = performance.now(); extractMainContent($nested); const nestedMs = performance.now() - t;
    const ratio = flatMs / Math.max(nestedMs, 0.5);
    expect(ratio, `flat ${flatMs.toFixed(0)}ms / nested ${nestedMs.toFixed(0)}ms = ${ratio.toFixed(1)}x`).toBeLessThan(5);
  }, 30_000);

  it('COMPLEXITY: on the DEPTH axis, extraction stays a small fraction of the parse', () => {
    // The width test above pins the axis that was FIXED. This pins the axis that is not linear and never
    // was: nesting depth is superlinear in cheerio itself, engine-wide, and `extractPage` pays it with AI
    // extraction switched off entirely. An absolute bound here would just be re-measuring cheerio and
    // would flake for its trouble.
    //
    // So the guard is the MARGINAL cost — extraction relative to the parse the page already pays.
    // Measured stable at 0.23x (depth 4 000) and 0.20x (depth 16 000); the bound is 1.0x, which a real
    // depth regression in this walk would blow through while machine speed cancels out.
    const html = `<html><body>${'<div>'.repeat(8_000)}prose${'</div>'.repeat(8_000)}</body></html>`;
    let t = performance.now();
    const $ = cheerio.load(html);
    const parseMs = performance.now() - t;
    t = performance.now();
    const out = extractMainContent($);
    const extractMs = performance.now() - t;
    expect(out.mainTextChars, 'the prose must survive the depth').toBe(5);
    const ratio = extractMs / Math.max(parseMs, 1);
    expect(ratio, `extract ${extractMs.toFixed(0)}ms / parse ${parseMs.toFixed(0)}ms = ${ratio.toFixed(2)}x`).toBeLessThan(1);
  }, 30_000);

  it('does NOT mutate the caller\u2019s DOM — nothing is cloned, so the walk must be read-only', () => {
    const $ = cheerio.load('<html><body><nav>N</nav><p>P</p><footer>F</footer></body></html>');
    extractMainContent($);
    expect($('nav').length, 'nav must still be in the DOM').toBe(1);
    expect($('footer').length, 'footer must still be in the DOM').toBe(1);
    expect($('body').text()).toBe('NPF');
  });
});
