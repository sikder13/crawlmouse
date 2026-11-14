/** The 410 page of a share link that no longer opens (CC-39 F6): drawn in the v2 design, not bare HTML. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SUPPORT_EMAIL } from '../../../components/v2/footer-links';
import { GONE_PAGE } from './share';
import { GONE_MARK, GONE_SUPPORT, GONE_TOKENS } from './share-gone';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CrawlmouseMark } from '../../../components/icons/CrawlmouseMark';

const TOKENS = readFileSync(resolve(__dirname, '../../../styles/v2/tokens.css'), 'utf8');

/** The declarations of the first block whose selector line is `selector`, as name → value. */
function block(selector: string): Map<string, string> {
  const start = TOKENS.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = TOKENS.slice(start, TOKENS.indexOf('}', start));
  return new Map([...body.matchAll(/(--v2-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!]));
}

const style = () => /<style>([\s\S]*?)<\/style>/.exec(GONE_PAGE)?.[1] ?? '';

describe('the gone page, in the v2 design', () => {
  it('declares each token it uses with the value styles/v2/tokens.css gives it, light and dark', () => {
    const light = block(':root');
    const dark = block(":root[data-theme='dark']");
    for (const [name, value] of Object.entries(GONE_TOKENS.light)) {
      expect(value, name).toBe(light.get(name));
      expect(style()).toContain(`${name}:${value};`);
    }
    for (const [name, value] of Object.entries(GONE_TOKENS.dark)) {
      expect(value, name).toBe(dark.get(name));
    }
    expect(style()).toMatch(/@media \(prefers-color-scheme: dark\)\{:root\{[^}]*--v2-bg:#0f1317;/);
  });

  it('draws only with the tokens it declares', () => {
    const used = new Set([...style().matchAll(/var\((--v2-[\w-]+)\)/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(0);
    for (const name of used) expect(Object.keys(GONE_TOKENS.light), name).toContain(name);
  });

  it('wears the app header with the brand, then the heading, the reason and the support address', () => {
    expect(GONE_PAGE).toMatch(
      /<header><div class="bar"><a class="brand" href="\/" aria-label="Crawlmouse home"><svg [^>]*class="mark"/,
    );
    expect(GONE_PAGE).toContain('<span class="wordmark">crawl<span>mouse</span></span>');
    const main = /<main>([\s\S]*)<\/main>/.exec(GONE_PAGE)?.[1] ?? '';
    expect([...main.matchAll(/<(h1|p)>([\s\S]*?)<\/\1>/g)].map((m) => m[2])).toEqual([
      'This link no longer opens',
      'It has expired or was withdrawn by the person who shared it. Ask them for a new link.',
      `Something else: write to <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.`,
    ]);
  });
});

describe('the constants written out for the server graph (CC-39 review r1, security)', () => {
  it('the mark is the one CrawlmouseMark renders at 24px', () => {
    expect(GONE_MARK).toBe(
      renderToStaticMarkup(createElement(CrawlmouseMark, { size: 24, className: 'mark' })),
    );
  });

  it('the support address is the footer’s', () => {
    expect(GONE_SUPPORT).toBe(SUPPORT_EMAIL);
  });

  it('the module imports nothing a server component may not', () => {
    const source = readFileSync(resolve(__dirname, 'share-gone.ts'), 'utf8');
    const imports = source.split('\n').filter((l) => /^import\b/.test(l));
    expect(imports.filter((l) => /react-dom\/server|components\//.test(l))).toEqual([]);
  });
});
