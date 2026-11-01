// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ContentScreen } from '../../components/v2/screens/segment/ContentScreen';
import { NoJsScreen } from '../../components/v2/screens/segment/NoJsScreen';
import { SEGMENT_PREVIEWS } from '../../app/(v2-preview)/v2-preview/_preview/segments';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});
const mount = (el: React.ReactElement) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host;
};
const css = (file: string) =>
  readFileSync(join(process.cwd(), 'components', 'v2', 'screens', 'segment', file), 'utf8');

describe('Readable without JavaScript, operated', () => {
  it('makes each row’s status a button that names its page, and shows the selected page’s two responses', () => {
    const host = mount(<NoJsScreen data={SEGMENT_PREVIEWS.nojs('bad-site')} />);
    const rows = [...host.querySelectorAll<HTMLButtonElement>('[data-v2-row]')];
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r.type).toBe('button');
      expect(r.textContent).toMatch(/^\/[\w/-]*: /);
    }
    const band = host.querySelector('[data-v2-evidence-band]')!;
    expect(band.getAttribute('aria-live')).toBe('polite');
    expect(band.textContent).toContain('Evidence · /products/ridge-2p · 02:33:41 UTC');
    const home = rows[0]!;
    act(() => home.click());
    expect(home.getAttribute('aria-pressed')).toBe('true');
    expect(band.textContent).toBe(
      'This record holds 8 of the 408 responses the audit kept, and this page’s are not among them.',
    );
  });

  it('says there is nothing to compare when the record holds no measured page', () => {
    const host = mount(<NoJsScreen data={SEGMENT_PREVIEWS.nojs('challenged')} />);
    expect(host.querySelectorAll('[data-v2-row]')).toHaveLength(0);
    expect(host.querySelector('[data-v2-evidence-band]')!.textContent).toBe(
      'No measured page is in this record to compare.',
    );
  });

  it('draws a visible focus ring on a row’s button', () => {
    expect(css('NoJsScreen.module.css')).toMatch(
      /\.select:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--v2-fg\)/,
    );
  });
});

describe('Content, operated', () => {
  it('shows, for the selected cell, the failing pages in the record and the first words of one', () => {
    const host = mount(<ContentScreen data={SEGMENT_PREVIEWS.content('bad-site')} />);
    const band = () => host.querySelector('[data-v2-evidence-band]')!;
    expect(band().getAttribute('aria-live')).toBe('polite');
    expect(band().textContent).toContain('/products/ridge-2p');
    expect(band().textContent).toContain('/products/alpine-stove');
    const blogAuthors = host.querySelector<HTMLButtonElement>(
      '[data-v2-cell="author_and_date|/blog/{slug}"]',
    )!;
    expect(blogAuthors.textContent).toMatch(/^blog, Author and date visible: /);
    act(() => blogAuthors.click());
    expect(blogAuthors.getAttribute('aria-pressed')).toBe('true');
    expect(band().textContent).toBe(
      'This record holds 16 of the 214 pages of this audit, and none of them fails this check here.',
    );
  });

  it('draws a visible focus ring on a cell', () => {
    expect(css('ContentScreen.module.css')).toMatch(
      /\.select:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--v2-fg\)/,
    );
  });
});
