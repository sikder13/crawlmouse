/**
 * The front-end markers the reader records on a batch's first page (CC-30 Q2). Each marker is one
 * fixed test over where its framework writes it (frontend-markers.ts says each): a script's `src` or a
 * link's `href`, a script's id, an assignment in a script the browser runs as JavaScript, an element's
 * class, the root element's attribute, a response header. Page text, other attributes, comments,
 * strings, data scripts and what `textarea`, `template` and `noscript` hold are not read, and a row
 * stores marker names only, never what the page held. Every case goes through `readPage`.
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

describe('where the markers are not read (review B2)', () => {
  const none = (name: string, body: string) => expect(markersOf(page('', body)), name).toEqual([]);

  it('reads the Shopify.theme object only as an assignment in a script run as JavaScript', () => {
    none(
      'JSON-LD',
      '<script type="application/ld+json">{"@type":"Article","articleBody":"Set Shopify.theme = {} in theme.liquid"}</script>',
    );
    none('text/plain', '<script type="text/plain">Shopify.theme = {}</script>');
    none('a template type', '<script type="text/x-template">Shopify.theme = {}</script>');
    none(
      'a line comment',
      '<script>// we migrated off Shopify.theme = {} last year\nvar a = 1;</script>',
    );
    none('a block comment', '<script>/* Shopify.theme = {} */ var a = 1;</script>');
    none(
      'a string',
      '<script>var s = "Shopify.theme = {}"; var t = \'Shopify.theme = 1\';</script>',
    );
    none('a template literal', '<script>var s = `Shopify.theme = ${1}`;</script>');
    none(
      'a read, not an assignment',
      '<script>if (Shopify.theme == null) go(Shopify.theme);</script>',
    );
    none('an arrow', '<script>const f = (Shopify.theme) => 1;</script>');
    none('a script file', '<script src="/x.js">Shopify.theme = {}</script>');
  });

  it('reads the Shopify.theme object from the scripts a Liquid layout writes', () => {
    const at = (script: string) => markersOf(page(script));
    expect(
      at(
        '<script>var Shopify = Shopify || {};\nShopify.shop = "a.myshopify.com";\nShopify.theme = {"name":"Dawn","id":1};</script>',
      ),
    ).toEqual(['shopify_theme_object']);
    expect(
      at('<script type="text/javascript">window.Shopify.theme={"name":"x"};</script>'),
    ).toEqual(['shopify_theme_object']);
    expect(at('<script type=" Text/JavaScript ">Shopify.theme = {};</script>')).toEqual([
      'shopify_theme_object',
    ]);
    // A comment or a string before the assignment does not hide it.
    expect(
      at('<script>var u = "https://a.test/x"; /* note */ // done\nShopify.theme = {};</script>'),
    ).toEqual(['shopify_theme_object']);
  });

  it('reads an assignment after a string that holds an escaped quote', () => {
    // The string ends at its first unescaped quote: an escaped one inside it does not end it, so the
    // code after it is read as code.
    const script = String.raw`<script>var s = "say \"hi\" to Shopify.theme"; Shopify.theme = {};</script>`;
    expect(markersOf(page(script))).toEqual(['shopify_theme_object']);
    const single = String.raw`<script>var s = 'it\'s'; Shopify.theme = {};</script>`;
    expect(markersOf(page(single))).toEqual(['shopify_theme_object']);
  });

  it('reads the Next.js asset path only from a script’s src or a link’s href', () => {
    const asset = 'https://cdn.example/_next/static/chunks/x.js';
    none('an anchor', `<article><a href="${asset}">a file</a></article>`);
    none('an image', '<img src="https://other.example/_next/static/media/a.png">');
    none(
      'other attributes',
      `<div data-src="${asset}" title="${asset}"><img alt="${asset}"></div>`,
    );
    none('a script’s other attribute', `<script data-href="${asset}"></script>`);
    none('a link’s other attribute', `<link rel="preload" data-src="${asset}" href="/a.css">`);
    expect(markersOf(page(`<link rel="preload" as="script" href="${asset}">`))).toEqual([
      'next_static_path',
    ]);
    expect(markersOf(page('<link rel="stylesheet" href="/_next/static/css/a.css">'))).toEqual([
      'next_static_path',
    ]);
    expect(markersOf(page(`<script src="${asset}" async></script>`))).toEqual(['next_static_path']);
  });

  it.each(['textarea', 'template', 'noscript'])('reads nothing %s holds', (tag) => {
    const held =
      '<div class="shopify-section"></div><script id="__NEXT_DATA__">{}</script>' +
      '<script>Shopify.theme = {};</script><script src="/_next/static/a.js"></script>' +
      '<link href="/wp-content/a.css">';
    none(tag, `<${tag}>${held}</${tag}>`);
    // and what follows it is read
    expect(markersOf(page('', `<${tag}>x</${tag}><div class="shopify-section"></div>`))).toEqual([
      'shopify_section_class',
    ]);
  });

  it('reads nothing an HTML comment holds', () => {
    none(
      'comment',
      '<!-- <div class="shopify-section"></div> <script id="__NEXT_DATA__"></script> -->',
    );
  });
});
