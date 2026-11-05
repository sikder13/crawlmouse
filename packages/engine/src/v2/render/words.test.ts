import * as cheerio from 'cheerio';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { countWords, mainWords } from './words.js';

vi.mock('cheerio', async (original) => {
  const real = await original<typeof import('cheerio')>();
  return { ...real, load: vi.fn(real.load) };
});
vi.mock('../../analysis/ai-readiness/main-content.js', async (original) => {
  const real = await original<typeof import('../../analysis/ai-readiness/main-content.js')>();
  return { ...real, extractMainContent: vi.fn(real.extractMainContent) };
});

const { extractMainContent } = await import('../../analysis/ai-readiness/main-content.js');
const { measurePage } = await import('./page.js');

afterEach(() => vi.clearAllMocks());

describe('countWords', () => {
  it('counts runs of non-space characters', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
    expect(countWords('one')).toBe(1);
    expect(countWords(' one  two\nthree\tfour ')).toBe(4);
    expect(countWords('co-op, re:use — ok')).toBe(4);
  });
});

describe('mainWords', () => {
  it('counts the words of the main content only, with navigation and footer stripped', () => {
    const html = `<body>
      <nav><a href="/a">Home</a><a href="/b">Shop</a><a href="/c">About</a></nav>
      <main><h1>Ridge tent</h1><p>Two person, three season.</p></main>
      <footer>Copyright notice text</footer>
    </body>`;
    // Counted by hand: "Ridge tent" (2) + "Two person, three season." (4).
    expect(mainWords(html)).toBe(6);
  });

  it('counts the same words whether or not the markup has whitespace between its blocks', () => {
    const server = `<body><main>
      <h1>Ridge tent</h1>
      <ul>
        <li>Two person</li>
        <li>Three season</li>
      </ul>
      <p>Weighs <b>1.9 kg</b>.</p>
    </main></body>`;
    const script =
      '<body><main><h1>Ridge tent</h1><ul><li>Two person</li><li>Three season</li></ul>' +
      '<p>Weighs <b>1.9 kg</b>.</p></main></body>';
    // By hand: Ridge, tent, Two, person, Three, season, Weighs, 1.9, kg. — nine.
    expect(mainWords(server)).toBe(9);
    expect(mainWords(script)).toBe(9);
  });

  it('does not split a word inside inline markup', () => {
    expect(mainWords('<body><main><p>co<b>op</b> <a href="/x">re</a>use</p></main></body>')).toBe(
      2,
    );
  });

  it('is zero for an empty application shell', () => {
    expect(mainWords('<body><div id="__next"></div><script src="/app.js"></script></body>')).toBe(
      0,
    );
  });
});

describe('the two sides of a page', () => {
  it('go through the same function, parsed the same way', () => {
    const staticHtml = '<body><main><p>Served text here.</p></main></body>';
    const renderedHtml =
      '<body><main><p>Served text here. And more from scripts.</p></main></body>';
    measurePage({ staticHtml, renderedHtml, previous: null });

    expect(extractMainContent).toHaveBeenCalledTimes(2);
    const loads = vi.mocked(cheerio.load).mock.calls;
    expect(loads.map((args) => args[0])).toEqual([staticHtml, renderedHtml]);
    // Neither call passes options, so both parses are cheerio's defaults: the same parser either side.
    expect(loads.map((args) => args.length)).toEqual([1, 1]);
  });
});
