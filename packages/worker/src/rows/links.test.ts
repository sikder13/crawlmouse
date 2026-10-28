import { extractPage } from '@crawlmouse/engine/worker';
import { describe, expect, it } from 'vitest';
import { MAX_LINKS_READ, MAX_URL_LENGTH, limitLinks, linksNotReadNote } from './links.js';
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
    expect(notRead).toEqual({ nested: 0, tooLong: 0, pastLimit: 0 });
    expect(links.map((l) => l.toUrl)).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('does not read a link nested inside another, so no anchor text holds another', () => {
    const depth = 300;
    const html = `<body>${'<a href="/x">'.repeat(depth)}${'w '.repeat(1000)}${'</a>'.repeat(depth)}</body>`;
    const { notRead, links } = read(html);
    expect(notRead.nested).toBe(depth - 1);
    expect(links).toHaveLength(1);
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
    expect(linksNotReadNote({ nested: 0, tooLong: 0, pastLimit: 0 })).toBeNull();
    expect(linksNotReadNote({ nested: 2, tooLong: 0, pastLimit: 1 })).toBe(
      `3 links were not read: 2 nested inside another link; 1 past the first ${MAX_LINKS_READ} on the page.`,
    );
  });
});
