import { extractPage } from '@crawlmouse/engine/worker';
import { describe, expect, it } from 'vitest';
import {
  MAX_ANCHOR_TEXT_CHARS,
  MAX_LINKS_READ,
  MAX_URL_LENGTH,
  limitLinks,
  linksNotReadNote,
} from './links.js';
import { parseHtml } from './text.js';

const BASE = 'https://example.com/';
const read = (html: string) => {
  const $ = parseHtml(html)!;
  const notRead = limitLinks($);
  return { notRead, links: extractPage($, BASE).links };
};

describe('limitLinks', () => {
  it('leaves an ordinary page alone', () => {
    const { notRead, links } = read('<body><a href="/a">A</a><p><a href="/b">B</a></p></body>');
    expect(notRead).toEqual({ tooLong: 0, pastLimit: 0, overTextLimit: 0 });
    expect(links.map((l) => l.toUrl)).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('reads links nested inside links, as browsers build them and v1 records them', () => {
    const card = (n: number) =>
      `<a href="/post-${n}"><h2>Post ${n}</h2><p>Filed in <a href="/category/news">News</a></p></a>`;
    const { notRead, links } = read(`<body>${card(1)}${card(2)}</body>`);
    expect(notRead).toEqual({ tooLong: 0, pastLimit: 0, overTextLimit: 0 });
    expect(links.map((l) => l.toUrl)).toEqual([
      'https://example.com/post-1',
      'https://example.com/category/news',
      'https://example.com/post-2',
      'https://example.com/category/news',
    ]);
  });

  it('stops reading nested links once their copied anchor text would pass the page limit', () => {
    // 500 links nested around 1,000,000 characters: each level copies the same text again.
    const depth = 500;
    const html = `<body>${'<a href="/x">'.repeat(depth)}${'w '.repeat(500_000)}${'</a>'.repeat(depth)}</body>`;
    const { notRead, links } = read(html);
    const perLink = 1_000_000;
    expect(links).toHaveLength(Math.floor(MAX_ANCHOR_TEXT_CHARS / perLink));
    expect(notRead.overTextLimit).toBe(depth - links.length);
  });

  it(`reads an href of exactly ${MAX_URL_LENGTH} characters`, () => {
    const exact = `/${'p'.repeat(MAX_URL_LENGTH - 1)}`;
    expect(read(`<body><a href="${exact}">e</a></body>`).notRead.tooLong).toBe(0);
  });

  it(`does not read an href longer than ${MAX_URL_LENGTH} characters`, () => {
    const long = `/${'p'.repeat(MAX_URL_LENGTH)}`;
    const { notRead, links } = read(`<body><a href="${long}">long</a><a href="/ok">ok</a></body>`);
    expect(notRead.tooLong).toBe(1);
    expect(links.map((l) => l.toUrl)).toEqual(['https://example.com/ok']);
  });

  it(`reads the first ${MAX_LINKS_READ} links of a page with 500,000 and no more`, () => {
    const html = `<body>${'<a href="/l">l</a>'.repeat(500_000)}</body>`;
    const { notRead, links } = read(html);
    expect(links).toHaveLength(MAX_LINKS_READ);
    expect(notRead.pastLimit).toBe(500_000 - MAX_LINKS_READ);
  });

  it('says what it did not read, from the counts', () => {
    expect(linksNotReadNote({ tooLong: 0, pastLimit: 0, overTextLimit: 0 })).toBeNull();
    expect(linksNotReadNote({ tooLong: 2, pastLimit: 1, overTextLimit: 0 })).toBe(
      `3 links were not read: 2 with a URL over ${MAX_URL_LENGTH} characters; 1 past the first ${MAX_LINKS_READ} on the page.`,
    );
  });
});
