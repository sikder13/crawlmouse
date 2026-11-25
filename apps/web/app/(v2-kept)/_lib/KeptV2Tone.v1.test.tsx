/**
 * F-265: the v2 tone changes the kept pages only. v1's own blog, guides and author pages render
 * without it, and the only source that applies it is the kept shell.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { WEB_ROOT } from '../../../__tests__/v2/_lib/tokens-css';

vi.mock('@/components/layout/Header', () => ({ Header: () => <header>v1 header</header> }));
vi.mock('@/components/layout/Footer', () => ({ Footer: () => <footer>v1 footer</footer> }));

const params = (slug: string) => ({ params: Promise.resolve({ slug }) }) as never;
type Page = (props: never) => ReactNode | Promise<ReactNode>;

const V1: [string, () => Promise<{ default: Page }>, unknown?][] = [
  ['/blog', () => import('@/app/blog/page')],
  ['/blog/research', () => import('@/app/blog/research/page')],
  ['/blog/orphan-pages', () => import('@/app/blog/[slug]/page'), params('orphan-pages')],
  ['/guides', () => import('@/app/guides/page')],
  ['/authors/udaay-sikder', () => import('@/app/authors/[slug]/page'), params('udaay-sikder')],
];

describe("v1's own pages, without the v2 tone", () => {
  it.each(V1)(
    '%s renders with no tone attribute and no tone class',
    async (_path, load, props) => {
      const page = (await load()).default;
      const markup = renderToStaticMarkup(<>{await page(props as never)}</>);
      expect(markup.length).toBeGreaterThan(500);
      expect(markup).toContain('<h1');
      expect(markup).not.toContain('data-v1-tone');
      expect(markup).not.toContain('data-v1-content');
      expect(markup).not.toMatch(/class="[^"]*\btone\b/);
      expect(markup).not.toMatch(/_tone_/);
    },
    60_000,
  );
});

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('where the tone is applied', () => {
  const files = ['app', 'components', 'lib', 'styles'].flatMap((d) => sources(join(WEB_ROOT, d)));

  it('reads app/, components/, lib/ and styles/', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('only the kept shell imports the tone module or sets the tone attribute', () => {
    const naming = files
      .filter((f) => /KeptV2Tone\.module\.css|data-v1-tone/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(WEB_ROOT, f))
      .sort();
    expect(naming).toEqual(['app/(v2-kept)/_lib/KeptShell.tsx']);
  });
});
