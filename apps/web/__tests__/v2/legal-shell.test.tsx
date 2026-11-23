/**
 * RC-08: the legal pages on the v2 design. The words are the v1 page's own output, so a layout change
 * cannot alter legal text; `kept-pages.test.tsx` holds the markup equal to v1's.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PAGES = [
  ['/privacy', () => import('../../app/(v2-kept)/v2-kept/privacy/page')],
  ['/terms', () => import('../../app/(v2-kept)/v2-kept/terms/page')],
  ['/aup', () => import('../../app/(v2-kept)/v2-kept/aup/page')],
  ['/subprocessors', () => import('../../app/(v2-kept)/v2-kept/subprocessors/page')],
  ['/takedown', () => import('../../app/(v2-kept)/v2-kept/takedown/page')],
] as const;

beforeEach(() => vi.stubEnv('V2_CHECKS_PUBLIC', '1'));
afterEach(() => vi.unstubAllEnvs());

const docOf = async (load: (typeof PAGES)[number][1]) => {
  const { default: Page } = await load();
  return new JSDOM(renderToStaticMarkup(Page() as ReactElement)).window.document;
};

describe.each(PAGES)('%s on v2', (_path, load) => {
  it('is in the v2 shell and is no longer a kept v1 body', async () => {
    const doc = await docOf(load);
    expect(doc.querySelector('[data-v2-shell] > [data-v2-legal]')).not.toBeNull();
    expect(doc.querySelector('[data-v2-kept]')).toBeNull();
    expect(doc.querySelectorAll('h1')).toHaveLength(1);
    expect(doc.querySelectorAll('main')).toHaveLength(1);
    expect(doc.querySelector('[data-v2-shell] > footer')).not.toBeNull();
  }, 60_000);
});

describe('what the visual harness draws', () => {
  it.each(['takedown', 'privacy', 'terms', 'aup', 'subprocessors'])(
    'the %s preview is the page on the v2 design',
    async (key) => {
      const { KEPT_RENDERS } =
        await import('../../app/(v2-preview)/kept-preview/_lib/kept-renders');
      const html = renderToStaticMarkup((await KEPT_RENDERS[key]!()) as ReactElement);
      expect(html).toContain('data-v2-legal=""');
      expect(html).not.toContain('data-v2-kept');
    },
    60_000,
  );
});

describe('printing a legal page', () => {
  const css = readFileSync(
    join(__dirname, '../../app/(v2-kept)/_lib/LegalShell.module.css'),
    'utf8',
  );
  const print = css.slice(css.indexOf('@media print'));

  it('hides the header and footer, and prints dark text', () => {
    expect(print).toMatch(/\.frame > \[data-v2-shell\] > header/);
    expect(print).toMatch(/\.frame > \[data-v2-shell\] > \[data-v2-footer\]/);
    expect(print).toMatch(/display:\s*none/);
    expect(print).toMatch(/color: #13161b !important/);
  });

  it('those selectors name what the page draws', async () => {
    const doc = await docOf(PAGES[1][1]);
    expect(doc.querySelectorAll('[data-v2-legal-frame] > [data-v2-shell] > header')).toHaveLength(
      1,
    );
    expect(
      doc.querySelectorAll('[data-v2-legal-frame] > [data-v2-shell] > [data-v2-footer]'),
    ).toHaveLength(1);
  }, 60_000);
});
