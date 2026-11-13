/**
 * The front-end markers the reader records on a batch's first page (CC-30 Q2). Each marker is one
 * fixed test over where the framework writes it: an attribute, an element's id or class, an inline
 * script, a response header. The page's text is not read, so a marker's literal in an article or a
 * code sample does not match, and a row stores marker names only, never what the page held.
 */
import { FrontendMarkerSchema, type FrontendMarker } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { readPage, type StackHeaders } from './read.js';

const URL_ = 'https://a.test/';
const markersOf = (body: string, headers: StackHeaders = {}): FrontendMarker[] | undefined =>
  readPage({ body, bodyCut: false, finalUrl: URL_, stackHeaders: headers }).read?.stack
    ?.frontendMarkers;
const page = (head: string, body = '', html = '<html>') =>
  `${html}<head>${head}</head><body><h1>Home</h1>${body}<p>Some words on the page.</p></body></html>`;

/** One page that carries each marker where its framework writes it, and nothing else. */
const CARRIES: Record<FrontendMarker, { body: string; headers?: StackHeaders }> = {
  next_static_path: {
    body: page('<script src="/_next/static/chunks/main-abc.js" defer></script>'),
  },
  next_data_script: {
    body: page('', '<script id="__NEXT_DATA__" type="application/json">{"props":{}}</script>'),
  },
  shopify_theme_object: {
    body: page(
      '<script>window.Shopify = window.Shopify || {};\nShopify.theme = {"name":"Dawn"};</script>',
    ),
  },
  shopify_section_class: {
    body: page('', '<div id="shopify-section-header" class="shopify-section header"></div>'),
  },
  hydrogen_powered_by_header: { body: page(''), headers: { 'powered-by': 'Shopify, Hydrogen' } },
  wp_content_path: {
    body: page('<link rel="stylesheet" href="https://a.test/wp-content/themes/x/style.css">'),
  },
  webflow_site_attribute: {
    body: page('', '', '<html data-wf-domain="a.test" data-wf-page="p1" data-wf-site="s1">'),
  },
};

/** Each marker's literal written as text a visitor reads, and as text in a code sample. */
const PROSE = page(
  '',
  '<article><p>Next.js serves its chunks from /_next/static/ and writes id="__NEXT_DATA__"; a ' +
    'Liquid theme sets Shopify.theme and wraps sections in class="shopify-section"; Hydrogen ' +
    'answers with powered-by: Shopify, Hydrogen; WordPress serves /wp-content/; Webflow writes ' +
    'data-wf-site on the root.</p>' +
    '<pre><code>&lt;script src="/_next/static/x.js"&gt;&lt;/script&gt; ' +
    '&lt;div class="shopify-section"&gt; data-wf-site="s1" /wp-content/</code></pre></article>',
);

/** Other frameworks' own markers, which name none of the seven. */
const OTHER_FRAMEWORKS = page(
  '<script src="/_nuxt/entry.js"></script><link rel="stylesheet" href="/_astro/index.css">' +
    '<meta name="generator" content="Gatsby 5"><script>window.__NUXT__={};</script>',
  '<div id="__nuxt" data-reactroot="" ng-version="17.0.0" data-svelte-h="x">' +
    '<div id="___gatsby"></div><div data-v-app></div>' +
    '<script id="__NEXT_DATA_LIKE__">Shopify.themeish</script>' +
    '<script>Shopify.themes = [];Shopify.theme_x = 1;</script>' +
    '<div class="shopify-sections not-a-section"></div>' +
    '<img src="/next/static/a.png"><a href="/wp-contents/">x</a></div>',
);

describe('front-end markers', () => {
  it.each(FrontendMarkerSchema.options)('records %s from where its framework writes it', (m) => {
    const { body, headers } = CARRIES[m];
    expect(markersOf(body, headers)).toEqual([m]);
  });

  it('records none on a page without them, and the list is empty rather than absent', () => {
    expect(markersOf(page(''))).toEqual([]);
  });

  it('records none from the markers written as text or in a code sample', () => {
    expect(markersOf(PROSE)).toEqual([]);
  });

  it("records none from other frameworks' markers or from near-misses of the seven", () => {
    expect(markersOf(OTHER_FRAMEWORKS)).toEqual([]);
  });

  it('records only enum values, on a page carrying every marker among other strings', () => {
    const all = page(
      '<script src="/_nuxt/x.js"></script><script src="/_next/static/a.js"></script>' +
        '<link href="/wp-content/a.css" rel="stylesheet"><script>Shopify.theme = {};</script>',
      `${PROSE}<div class="x shopify-section"></div><script id="__NEXT_DATA__">{}</script>`,
      '<html data-wf-site="s1" ng-version="17">',
    );
    const got = markersOf(all, { 'powered-by': 'Shopify, Hydrogen', server: 'nginx' })!;
    expect(got).toEqual(FrontendMarkerSchema.options);
    for (const m of got) expect(FrontendMarkerSchema.options).toContain(m);
  });

  it('lists the markers in the enum order, whatever order the page holds them in', () => {
    const reversed = page(
      '',
      '<div class="shopify-section"></div><link href="/wp-content/a.css"><script src="/_next/static/a.js"></script>',
      '<html data-wf-site="s1">',
    );
    expect(markersOf(reversed)).toEqual([
      'next_static_path',
      'shopify_section_class',
      'wp_content_path',
      'webflow_site_attribute',
    ]);
  });

  it('reads the powered-by header as Hydrogen sets it, alone or after another value', () => {
    const h = (v: string) => markersOf(page(''), { 'powered-by': v });
    expect(h('Shopify, Hydrogen')).toEqual(['hydrogen_powered_by_header']);
    // The worker joins a repeated header with ", " (batch/crawl.ts stackHeaders).
    expect(h('Express, Shopify, Hydrogen')).toEqual(['hydrogen_powered_by_header']);
    expect(h('shopify,hydrogen')).toEqual(['hydrogen_powered_by_header']);
    expect(h('Shopify')).toEqual([]);
    expect(h('Hydrogen')).toEqual([]);
    expect(h('Shopify Hydrogen-ish')).toEqual([]);
    // Another header carrying the value is not the marker.
    expect(markersOf(page(''), { 'x-powered-by': 'Shopify, Hydrogen' })).toEqual([]);
  });

  it('reads the Webflow attribute on the root element only', () => {
    expect(markersOf(page('', '<div data-wf-site="s1"></div>'))).toEqual([]);
  });

  it('reads the Next.js data script by its exact id, and the Liquid object from an inline script only', () => {
    expect(markersOf(page('', '<div id="__NEXT_DATA__"></div>'))).toEqual([]);
    expect(markersOf(page('<script src="/x.js">Shopify.theme</script>'))).toEqual([]);
    expect(markersOf(page('<style>.Shopify.theme{}</style>'))).toEqual([]);
  });

  it('records no markers on a page it did not read: nested past the depth it reads', () => {
    const deep = `<html><body>${'<div>'.repeat(600)}<script src="/_next/static/a.js"></script></body></html>`;
    expect(
      readPage({ body: deep, bodyCut: false, finalUrl: URL_, stackHeaders: {} }).read,
    ).toBeNull();
  });

  it('records no markers when the stack was not asked for (a URL after the batch’s first)', () => {
    const { body } = CARRIES.next_static_path;
    expect(readPage({ body, bodyCut: false, finalUrl: URL_ }).read!.stack).toBeNull();
  });
});
