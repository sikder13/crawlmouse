/**
 * The two sides of a page are counted by one function, `mainWords`, which parses with cheerio's
 * defaults and runs `extractMainContent`. Each of the three is replaced by a recording wrapper.
 */
import * as cheerio from 'cheerio';
import { describe, expect, it, vi } from 'vitest';

vi.mock('cheerio', async (original) => {
  const real = await original<typeof import('cheerio')>();
  return { ...real, load: vi.fn(real.load) };
});
vi.mock('../../analysis/ai-readiness/main-content.js', async (original) => {
  const real = await original<typeof import('../../analysis/ai-readiness/main-content.js')>();
  return { ...real, extractMainContent: vi.fn(real.extractMainContent) };
});
vi.mock('./words.js', async (original) => {
  const real = await original<typeof import('./words.js')>();
  return { ...real, mainWords: vi.fn(real.mainWords) };
});

const { extractMainContent } = await import('../../analysis/ai-readiness/main-content.js');
const { mainWords } = await import('./words.js');
const { measurePage } = await import('./page.js');

describe('the two sides of a page', () => {
  it('are each counted by mainWords, once, static side first', () => {
    const staticHtml = '<body><main><p>Served text here.</p></main></body>';
    const renderedHtml =
      '<body><main><p>Served text here. And more from scripts.</p></main></body>';
    measurePage({ staticHtml, renderedHtml, previous: null });

    expect(vi.mocked(mainWords).mock.calls).toEqual([[staticHtml], [renderedHtml]]);
    expect(extractMainContent).toHaveBeenCalledTimes(2);
    // Neither parse passes options, so both are cheerio's defaults: the same parser either side.
    expect(vi.mocked(cheerio.load).mock.calls.map((args) => args.length)).toEqual([1, 1]);
  });
});
