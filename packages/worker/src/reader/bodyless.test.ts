/**
 * A page with no `<body>` element, shaped like info.cern.ch's (packages/engine/fixtures/v2/main-content):
 * htmlparser2 builds no body for it, and the reader reads the body its HTML implies. Its main content,
 * simhash, served text and word count are those of the same page with explicit `<head>` and `<body>`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseHtml } from '../rows/text.js';
import { readPage, readWords } from './read.js';

const page = readFileSync(
  new URL('../../../engine/fixtures/v2/main-content/bodyless-1992.html', import.meta.url),
  'utf8',
);
const [titleLine, ...rest] = page.split('\n');
const explicit = `<HTML><HEAD>${titleLine}</HEAD><BODY>${rest.join('\n')}</BODY></HTML>`;

const read = (body: string) => readPage({ body, bodyCut: false, finalUrl: 'https://a.test/p' });

describe('a page with no <body>', () => {
  it('has none under the worker’s parser', () => {
    expect(parseHtml(page)!('body')).toHaveLength(0);
    expect(parseHtml(explicit)!('body')).toHaveLength(1);
  });

  it('gets a simhash, the explicit-body page’s', () => {
    const bare = read(page).read!;
    expect(bare.simhash).toMatch(/^[0-9a-f]{16}$/);
    expect(bare.simhash).toBe(read(explicit).read!.simhash);
  });

  it('gets the explicit-body page’s served text and word count: the title is not body text', () => {
    const bare = read(page).read!;
    const withBody = read(explicit).read!;
    expect(bare.rawText).toMatch(/^Hypertext Project - Overview The project joins/);
    expect(bare.rawText).not.toContain('Overview -- /Project');
    expect(bare.rawText).toBe(withBody.rawText);
    expect(bare.words).toBe(withBody.words);
    expect(readWords({ body: page, bodyCut: false })).toEqual(
      readWords({ body: explicit, bodyCut: false }),
    );
  });

  it('reads the same links', () => {
    expect(read(page).read!.links).toEqual(read(explicit).read!.links);
  });
});
