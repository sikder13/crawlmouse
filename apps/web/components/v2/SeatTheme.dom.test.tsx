// @vitest-environment jsdom
/**
 * F-292 (D-29): a signed-in page outside the account shell wears the seat's theme the way the
 * dashboard does (`ThemeControl`): this browser's own choice first, else the seat's; Light and Dark
 * set `data-theme`, System leaves it unset so the device decides.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SeatTheme } from './SeatTheme';
import type { ThemeChoice } from './theme-choices';

let root: Root | null = null;
let host: HTMLElement;

beforeEach(() => {
  delete document.documentElement.dataset.theme;
  window.localStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  delete document.documentElement.dataset.theme;
  window.localStorage.clear();
});

const mount = (theme: ThemeChoice) => {
  root = createRoot(host);
  act(() => root!.render(<SeatTheme theme={theme} />));
};

describe('SeatTheme', () => {
  it.each([
    ['dark', 'dark'],
    ['light', 'light'],
    ['system', undefined],
  ] as const)('the seat theme %s leaves data-theme as %s', (theme, expected) => {
    // A value a previous page left must not survive System.
    document.documentElement.dataset.theme = 'light';
    if (theme === 'light') document.documentElement.dataset.theme = 'dark';
    mount(theme);
    expect(document.documentElement.dataset.theme).toBe(expected);
  });

  it('this browser’s own choice wins over the seat’s, as on the dashboard', () => {
    window.localStorage.setItem('crawlmouse-theme', 'light');
    mount('dark');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('renders nothing: it is a page-level effect, not a control', () => {
    expect(renderToStaticMarkup(<SeatTheme theme="dark" />)).toBe('');
  });
});
