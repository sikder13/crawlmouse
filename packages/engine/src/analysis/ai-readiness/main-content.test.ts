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
});
