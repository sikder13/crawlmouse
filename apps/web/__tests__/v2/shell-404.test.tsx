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
import { NotFoundIsland } from '../../components/v2/screens/not-found/NotFoundIsland';
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

  it('the root 404 imports neither the screen nor the v2 stylesheet directly', () => {
    const source = readFileSync(join(__dirname, '../../app/not-found.tsx'), 'utf8');
    expect(source).not.toMatch(/NotFoundScreen|styles\/v2/);
    const island = readFileSync(
      join(__dirname, '../../components/v2/screens/not-found/NotFoundIsland.tsx'),
      'utf8',
    );
    expect(island).toMatch(/import\('\.\/NotFoundScreen'\)/);
    expect(island).toMatch(/ssr: false/);
    expect(island).not.toMatch(/^import .*NotFoundScreen/m);
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
    expect(metadata.openGraph).toBeNull();
    expect(metadata.twitter).toBeNull();
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
