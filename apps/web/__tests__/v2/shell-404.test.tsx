/**
 * RC-20: the site's 404 in the v2 shell (F-026), the skip link on every shell page (F-085), and the
 * Free checks column on the `/check` pages (F-032, F-068).
 */
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageShell } from '../../components/v2/PageShell';
import { FOOTER_COLUMNS, MARKETING_NAV } from '../../components/v2/footer-links';
import {
  NotFoundIsland,
  loadNotFoundScreen,
} from '../../components/v2/screens/not-found/NotFoundIsland';
import { NotFoundScreen } from '../../components/v2/screens/not-found/NotFoundScreen';
import NotFound, { metadata } from '../../app/not-found';

afterEach(() => vi.unstubAllEnvs());

const docOf = (el: ReactElement) => new JSDOM(renderToStaticMarkup(el)).window.document;

describe('the site 404', () => {
  it('the v2 screen is the shell, one h1, with ways on and no v1 mark', () => {
    const doc = docOf(<NotFoundScreen />);
    expect(doc.querySelector('[data-v2-shell]')).not.toBeNull();
    expect(doc.querySelectorAll('h1')).toHaveLength(1);
    expect(doc.querySelector('footer')).not.toBeNull();
    const main = [...doc.querySelectorAll('main a')].map((a) => a.getAttribute('href'));
    expect(main).toEqual(['/', '/pricing', '/help']);
    expect(doc.body.innerHTML).not.toContain('bg-cream');
    // The footer is drawn in the browser, where the flags cannot be read.
    expect(doc.querySelector('footer a[href="/check/gptbot"]')).not.toBeNull();
  });

  it('with public checks on, the root 404 is the island and not the shell', () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    const el = NotFound() as ReactElement;
    expect(el.type).toBe(NotFoundIsland);
    const doc = docOf(el);
    expect(doc.querySelector('[data-v2-shell]')).toBeNull();
    expect(doc.body.innerHTML).not.toContain('bg-cream');
  });

  const v2Imports = (source: string) =>
    [...source.matchAll(/^import\s(?:[^;'"]*?\sfrom\s+)?'([^']+)';/gm)]
      .map((m) => m[1]!)
      .filter((m) => /components\/v2|styles\/v2|^\.\.?\//.test(m));
  const read = (...p: string[]) => readFileSync(join(__dirname, '../..', ...p), 'utf8');

  it('the root 404 statically imports only the island from v2', () => {
    expect(v2Imports(read('app/not-found.tsx'))).toEqual([
      '@/components/v2/screens/not-found/NotFoundIsland',
    ]);
  });

  it('the island imports no v2 component statically, and loads the screen on demand', () => {
    const island = read('components/v2/screens/not-found/NotFoundIsland.tsx');
    expect(v2Imports(island)).toEqual([]);
    expect(island).toMatch(/import\('\.\/NotFoundScreen'\)/);
    expect(island).toMatch(/ssr: false/);
  });

  it('falls back to the plain 404 when the screen’s chunk cannot load', async () => {
    const Loaded = await loadNotFoundScreen(() => Promise.reject(new Error('chunk failed')));
    const doc = docOf(<Loaded />);
    expect(doc.querySelector('h1')!.textContent).toBe('This page isn’t here');
    expect(doc.querySelector('a[href="/"]')).not.toBeNull();
  });

  it('loads the real screen when its chunk arrives', async () => {
    const Loaded = await loadNotFoundScreen();
    expect(Loaded).toBe(NotFoundScreen);
  });

  it('with public checks off stays v1’s', () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    const doc = docOf(NotFound() as ReactElement);
    expect(doc.querySelector('[data-v2-shell]')).toBeNull();
    expect(doc.body.innerHTML).toContain('bg-cream');
  });

  it('does not inherit the home page’s title or canonical', () => {
    expect(metadata.title).toBe('Page not found');
    expect(metadata.alternates?.canonical).toBeNull();
    expect(metadata.openGraph).toEqual({ images: [] });
    expect(metadata.twitter).toEqual({ images: [] });
    expect(metadata.robots).toEqual({ index: false, follow: true });
  });
});

describe('the skip link', () => {
  const doc = () =>
    docOf(
      <PageShell nav={MARKETING_NAV}>
        <main>
          <a href="/x">first in main</a>
        </main>
      </PageShell>,
    );

  it('is the first focusable element and names a target that exists', () => {
    const d = doc();
    const first = d.querySelector('a[href], button')!;
    expect(first.textContent).toBe('Skip to content');
    const id = first.getAttribute('href')!.slice(1);
    expect(id).not.toBe('');
    expect(d.getElementById(id)).not.toBeNull();
  });

  it('lands after the header and before the page’s content, and can take focus', () => {
    const d = doc();
    const id = d.querySelector('a[href]')!.getAttribute('href')!.slice(1);
    const target = d.getElementById(id)!;
    expect(target.getAttribute('tabindex')).toBe('-1');
    expect(target.previousElementSibling?.tagName).toBe('HEADER');
    expect(target.nextElementSibling?.tagName).toBe('MAIN');
  });
});

describe('the Free checks column', () => {
  it('goes to the three /check pages, each under the flag that serves it', () => {
    const items = FOOTER_COLUMNS.find((c) => c.title === 'Free checks')!.items;
    expect(items.map((i) => ('href' in i ? i.href : null))).toEqual([
      '/check/gptbot',
      '/check/javascript',
      '/check/robots-ai',
    ]);
    for (const i of items) expect('gate' in i && i.gate).toBe('checksPublic');
  });
});
