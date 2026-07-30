import * as cheerio from 'cheerio';
import { describe, it, expect } from 'vitest';
import { classifyPageClass, detectCsrSignals } from './classify.js';

describe('classifyPageClass (§4.2 dual gate — extracted text is the verdict)', () => {
  it('text at/above MIN → readable regardless of CSR signals (the text gate wins)', () => {
    expect(classifyPageClass(250, [])).toBe('readable');
    expect(classifyPageClass(250, ['empty_mount:#__next'])).toBe('readable');
  });

  it('low text (< PARTIAL_FLOOR) + CSR evidence → js_blind', () => {
    expect(classifyPageClass(10, ['empty_mount:#__next'])).toBe('js_blind');
  });

  it('mid text (>= floor, < min) + CSR evidence → partial', () => {
    expect(classifyPageClass(120, ['shell_mount:#app'])).toBe('partial');
  });

  it('low text + NO CSR evidence → thin, NEVER js_blind (conservative bias)', () => {
    expect(classifyPageClass(10, [])).toBe('thin');
    expect(classifyPageClass(120, [])).toBe('thin');
  });

  // Pin the EXACT boundaries so a `>=`→`>` or `<`→`<=` mutation on the flagship component is caught.
  it('pins the MIN_MAIN_TEXT_CHARS boundary (200 = readable; 199 + csr = partial)', () => {
    expect(classifyPageClass(200, [])).toBe('readable');
    expect(classifyPageClass(199, ['empty_mount:#__next'])).toBe('partial'); // 199 >= PARTIAL_FLOOR
  });
  it('pins the PARTIAL_FLOOR boundary (50 + csr = partial; 49 + csr = js_blind)', () => {
    expect(classifyPageClass(50, ['empty_mount:#__next'])).toBe('partial');
    expect(classifyPageClass(49, ['empty_mount:#__next'])).toBe('js_blind');
  });
});

describe('detectCsrSignals (§4.2 affirmative per-page CSR evidence)', () => {
  it('an empty known mount node → empty_mount signal', () => {
    const s = detectCsrSignals(cheerio.load('<body><div id="__next"></div><script src="/b.js"></script></body>'));
    expect(s).toContain('empty_mount:#__next');
  });

  it('a noscript "enable JavaScript" notice → signal', () => {
    const s = detectCsrSignals(
      cheerio.load('<body><noscript>You need to enable JavaScript to run this app.</noscript><div id="app"></div></body>'),
    );
    expect(s).toContain('noscript_js_notice');
  });

  it('a FRAMEWORK mount with a hydration shell + a bundle → shell_mount signal', () => {
    const s = detectCsrSignals(cheerio.load('<body><div id="__next"><div>Loading…</div></div><script src="/b.js"></script></body>'));
    expect(s).toContain('shell_mount:#__next');
  });

  it('a thin static page (no known mount, no bundle) → NO signals → stays thin', () => {
    expect(detectCsrSignals(cheerio.load('<body><main><h1>Contact</h1><p>Email us</p></main></body>'))).toEqual([]);
  });

  it('a static page whose mount id has real text and no bundle → NO shell signal', () => {
    expect(detectCsrSignals(cheerio.load('<body><div id="root">Full static content here</div></body>'))).toEqual([]);
  });

  // Conservative bias (§4.2): a thin static page that happens to use a GENERIC wrapper id (#root/#app)
  // AND ships any analytics/jquery bundle must NOT be treated as a CSR shell. shell_mount fires ONLY on
  // framework-specific mounts (#__next/#__nuxt/[data-reactroot]/…), never on a non-empty generic wrapper.
  it('a NON-empty GENERIC mount (#app/#root) + a bundle → NO shell signal (thin static page, not a shell)', () => {
    expect(
      detectCsrSignals(cheerio.load('<body><div id="app"><h1>Contact</h1><p>Email us</p></div><script src="/jquery.js"></script></body>')),
    ).toEqual([]);
    expect(
      detectCsrSignals(cheerio.load('<body><div id="root"><h1>Coming soon</h1><p>Back shortly.</p></div><script src="/analytics.js"></script></body>')),
    ).toEqual([]);
  });

  it('a NON-empty FRAMEWORK mount (#__next) + a bundle → shell_mount (a real hydration shell)', () => {
    expect(
      detectCsrSignals(cheerio.load('<body><div id="__next"><div>Loading…</div></div><script src="/b.js"></script></body>')),
    ).toContain('shell_mount:#__next');
  });

  it('bounds the noscript scan — no ReDoS on a huge <noscript>, still detects a short notice', () => {
    const huge = 'need '.repeat(40_000); // ~200KB of "need " with no "JavaScript" → quadratic backtracking pre-fix
    const t0 = performance.now();
    const s = detectCsrSignals(cheerio.load(`<body><noscript>${huge}</noscript><div id="root"></div></body>`));
    const ms = performance.now() - t0;
    expect(s).not.toContain('noscript_js_notice'); // no false positive
    expect(ms).toBeLessThan(1000); // bounded (the unbounded regex takes seconds on this input pre-fix)
    // a short, real notice is still caught
    expect(
      detectCsrSignals(cheerio.load('<body><noscript>You need to enable JavaScript.</noscript><div id="app"></div></body>')),
    ).toContain('noscript_js_notice');
  });
});
