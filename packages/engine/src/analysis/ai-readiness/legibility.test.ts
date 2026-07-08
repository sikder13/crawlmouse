import * as cheerio from 'cheerio';
import { describe, it, expect } from 'vitest';
import { analyzeLegibility, detectFrameworkMarker } from './legibility.js';

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
