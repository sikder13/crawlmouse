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

  it('a mount with a hydration shell + a bundle → shell_mount signal', () => {
    const s = detectCsrSignals(cheerio.load('<body><div id="app"><div>Loading…</div></div><script src="/b.js"></script></body>'));
    expect(s).toContain('shell_mount:#app');
  });

  it('a thin static page (no known mount, no bundle) → NO signals → stays thin', () => {
    expect(detectCsrSignals(cheerio.load('<body><main><h1>Contact</h1><p>Email us</p></main></body>'))).toEqual([]);
  });

  it('a static page whose mount id has real text and no bundle → NO shell signal', () => {
    expect(detectCsrSignals(cheerio.load('<body><div id="root">Full static content here</div></body>'))).toEqual([]);
  });
});
