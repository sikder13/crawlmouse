// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AccessScreen } from '../../components/v2/screens/segment/AccessScreen';
import { SEGMENT_PREVIEWS } from '../../app/(v2-preview)/v2-preview/_preview/segments';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('the matrix, operated', () => {
  let root: Root | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = '';
  });
  const mount = () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<AccessScreen data={SEGMENT_PREVIEWS.access('bad-site')} />));
    return host;
  };

  it('makes every cell a button that says whose cell it is, pressed when selected', () => {
    const host = mount();
    const cells = [...host.querySelectorAll<HTMLButtonElement>('[data-v2-cell]')];
    expect(cells.length).toBe(2 + 6 * 4);
    for (const c of cells) {
      expect(c.tagName).toBe('BUTTON');
      expect(c.type).toBe('button');
      expect(c.getAttribute('aria-pressed')).toMatch(/^(true|false)$/);
      expect(c.textContent).toMatch(/^[\w-]+, [\w. ]+: /);
    }
    expect(cells.filter((c) => c.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
  });

  it('shows the selected cell’s raw request and response, from the fixture', () => {
    const host = mount();
    const band = host.querySelector('[data-v2-evidence-band]')!;
    expect(band.getAttribute('aria-live')).toBe('polite');
    expect(band.textContent).toContain('Evidence · GPTBot · homepage · 02:33:07 UTC');
    const perplexity = host.querySelector<HTMLButtonElement>('[data-v2-cell="PerplexityBot|/"]')!;
    act(() => perplexity.click());
    expect(perplexity.getAttribute('aria-pressed')).toBe('true');
    expect(band.textContent).toContain('Evidence · PerplexityBot · homepage');
    expect(band.textContent).toContain('Just a moment...');
    const noRecord = host.querySelector<HTMLButtonElement>('[data-v2-cell="GPTBot|/blog/{slug}"]')!;
    act(() => noRecord.click());
    expect(band.textContent).toBe(
      'This record holds 8 of the 408 responses the audit kept, and this cell’s is not one of them.',
    );
  });

  it('draws a visible focus ring on a cell (keyboard focus)', () => {
    const css = readFileSync(
      join(process.cwd(), 'components', 'v2', 'screens', 'segment', 'AccessScreen.module.css'),
      'utf8',
    );
    expect(css).toMatch(/\.cell:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--v2-fg\)/);
  });
});
