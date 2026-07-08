import * as cheerio from 'cheerio';
import { describe, it, expect } from 'vitest';
import { computePageAiSignals } from './page-signals.js';

const SSR_NEXT = `<html><head><title>Blog Post</title><meta name="description" content="A real post"></head>
<body><div id="__next"><header><nav><a href="/">Home</a></nav></header><main><h1>The Real Post</h1>
<p>${'This is a fully server-rendered article with plenty of genuine readable prose for an AI crawler. '.repeat(4)}</p></main>
<footer>Copyright 2026</footer></div><script id="__NEXT_DATA__" type="application/json">{"props":{}}</script><script src="/_next/static/chunk.js"></script></body></html>`;

const EMPTY_NEXT_SHELL = `<html><head><title>App</title></head><body><div id="__next"></div>
<script id="__NEXT_DATA__" type="application/json">{"props":{}}</script><script src="/_next/static/chunk.js"></script></body></html>`;

const THIN_CONTACT = `<html><head><title>Contact</title></head><body><main><h1>Contact</h1><p>Email hello@example.com</p></main></body></html>`;

describe('computePageAiSignals (§4 dual gate, end-to-end)', () => {
  it('SSR Next page WITH content → readable + nextjs marker + no CSR signals (A2)', () => {
    const s = computePageAiSignals(cheerio.load(SSR_NEXT));
    expect(s.pageClass).toBe('readable');
    expect(s.frameworkMarker).toBe('nextjs');
    expect(s.csrSignals).toEqual([]);
    expect(s.mainTextChars).toBeGreaterThanOrEqual(200);
    expect(s.excerpt).toContain('server-rendered article');
    expect(s.excerpt).not.toContain('Home'); // nav stripped from the excerpt (A4 no nav jumble)
    expect(s.hasTitle).toBe(true);
    expect(s.hasMainLandmark).toBe(true);
  });

  it('empty #__next shell + bundle → js_blind via the text gate (useEffect loophole) (A2)', () => {
    const s = computePageAiSignals(cheerio.load(EMPTY_NEXT_SHELL));
    expect(s.pageClass).toBe('js_blind');
    expect(s.csrSignals).toContain('empty_mount:#__next');
    expect(s.frameworkMarker).toBe('nextjs');
  });

  it('thin contact page → thin, never js_blind (A2)', () => {
    const s = computePageAiSignals(cheerio.load(THIN_CONTACT));
    expect(s.pageClass).toBe('thin');
    expect(s.csrSignals).toEqual([]);
  });

  it('is deterministic (A1): identical HTML → byte-identical signals incl. excerpt', () => {
    expect(computePageAiSignals(cheerio.load(SSR_NEXT))).toEqual(computePageAiSignals(cheerio.load(SSR_NEXT)));
  });

  it('does NOT mutate the shared $ (A1): nav, links, and #__next children survive', () => {
    const $ = cheerio.load(SSR_NEXT);
    const navBefore = $('nav').length;
    const linksBefore = $('a[href]').length;
    const nextChildrenBefore = $('#__next').children().length;
    computePageAiSignals($);
    expect($('nav').length).toBe(navBefore);
    expect($('a[href]').length).toBe(linksBefore);
    expect($('#__next').children().length).toBe(nextChildrenBefore);
  });
});
