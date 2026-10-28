// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { NavMenu } from '../../components/v2/NavMenu';
import { PageShell } from '../../components/v2/PageShell';
import { MARKETING_NAV, isGroup, type NavGroup } from '../../components/v2/footer-links';

// Under jsdom, import.meta.url is not a file URL, so _lib/tokens-css's WEB_ROOT cannot be used here.
const WEB_ROOT = join(__dirname, '..', '..');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LEARN = MARKETING_NAV.find(isGroup) as NavGroup;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

/** The menu, with a focusable control outside it to move focus and clicks to. */
function mount() {
  const host = document.createElement('div');
  const outside = document.createElement('button');
  outside.textContent = 'outside';
  document.body.append(host, outside);
  root = createRoot(host);
  act(() => root!.render(<NavMenu group={LEARN} />));
  const button = host.querySelector('button') as HTMLButtonElement;
  const list = () => document.getElementById(button.getAttribute('aria-controls') ?? '');
  return { host, outside, button, list };
}

const key = (el: Element, k: string) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  });

describe('NavMenu (the header’s Learn menu)', () => {
  it('starts closed: a button that names the menu and controls a hidden list', () => {
    const { button, list } = mount();
    expect(button.textContent).toBe('Learn');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(list()).not.toBeNull();
    expect(list()?.hasAttribute('hidden')).toBe(true);
  });

  it('is a disclosure of links, not an ARIA menu', () => {
    const { host } = mount();
    expect(host.querySelector('[role="menu"], [role="menuitem"], [aria-haspopup]')).toBeNull();
  });

  it('opens and closes from its button', () => {
    const { button, list } = mount();
    act(() => button.click());
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(list()?.hasAttribute('hidden')).toBe(false);
    act(() => button.click());
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(list()?.hasAttribute('hidden')).toBe(true);
  });

  it('lists the map’s Learn entries in order: live ones as links, planned ones as text', () => {
    const { button, list } = mount();
    act(() => button.click());
    const items = [...(list()?.querySelectorAll('li') ?? [])].map((li) => {
      const a = li.querySelector('a');
      return a ? [li.textContent, a.getAttribute('href')] : [li.textContent, 'planned'];
    });
    expect(items).toEqual(LEARN.items.map((i) => [i.label, i.planned ? 'planned' : i.href]));
    expect(items.map(([l]) => l)).toEqual(['Blog', 'Research', 'Guides', 'Docs', 'Developers']);
  });

  it('closes on Escape from inside, and gives focus back to its button', () => {
    const { button, list } = mount();
    act(() => button.click());
    const blog = list()?.querySelector('a') as HTMLAnchorElement;
    act(() => blog.focus());
    key(blog, 'Escape');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
  });

  it('closes on Escape with focus on its button', () => {
    const { button } = mount();
    act(() => button.click());
    act(() => button.focus());
    key(button, 'Escape');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
  });

  it('closes on Escape after focus has left it for nothing (a mouse open, a click on padding)', () => {
    const { button } = mount();
    act(() => button.click());
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    expect(document.activeElement).toBe(document.body);
    key(document.body, 'Escape');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
  });

  it('closes on Escape with focus elsewhere on the page, and leaves that focus where it is', () => {
    const { button, outside } = mount();
    act(() => button.click());
    act(() => outside.focus());
    key(outside, 'Escape');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(outside);
  });

  it('ignores Escape while closed, and other keys while open', () => {
    const { button, outside } = mount();
    act(() => outside.focus());
    key(button, 'Escape');
    expect(document.activeElement).toBe(outside);
    act(() => button.click());
    key(button, 'a');
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('closes when focus leaves it, and stays open while focus moves inside it', () => {
    const { host, button, outside, list } = mount();
    act(() => button.click());
    const [blog, research] = [...(list()?.querySelectorAll('a') ?? [])];
    const focusOut = (from: Element, to: Element | null) =>
      act(() => {
        from.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: to }));
      });
    focusOut(blog!, research!);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    focusOut(research!, outside);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(host.contains(outside)).toBe(false);
  });

  it('closes on a press outside it, and not on one inside it', () => {
    const { button, outside, list } = mount();
    act(() => button.click());
    const press = (el: Element) =>
      act(() => {
        el.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      });
    press(list()!.querySelector('a')!);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    press(outside);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('removes each document listener it adds, when it closes and when it unmounts', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const ours = (calls: unknown[][]) =>
      calls.filter(([type]) => type === 'pointerdown' || type === 'keydown');
    const allRemoved = () =>
      ours(add.mock.calls).every(([type, fn]) =>
        remove.mock.calls.some(([t, f]) => t === type && f === fn),
      );
    try {
      const { button } = mount();
      act(() => button.click());
      expect(ours(add.mock.calls).map(([t]) => t)).toEqual(['pointerdown', 'keydown']);
      expect(allRemoved()).toBe(false);
      act(() => button.click());
      expect(allRemoved()).toBe(true);
      act(() => button.click());
      expect(ours(add.mock.calls)).toHaveLength(4);
      act(() => root?.unmount());
      root = null;
      expect(allRemoved()).toBe(true);
    } finally {
      add.mockRestore();
      remove.mockRestore();
    }
  });

  it('reopens after a close by its button, and a press outside still closes it', () => {
    const { button, outside } = mount();
    act(() => button.click());
    act(() => button.click());
    act(() => button.click());
    expect(button.getAttribute('aria-expanded')).toBe('true');
    act(() => {
      outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('renders closed on the server, with its links in the markup', () => {
    const out = renderToStaticMarkup(<NavMenu group={LEARN} />);
    expect(out).toContain('aria-expanded="false"');
    expect(out).toMatch(/<ul [^>]*hidden=""/);
    expect(out).toContain('href="/blog"');
  });

  it('carries no animation: it opens and closes on state alone (rules 10 and 13)', () => {
    const css = readFileSync(join(WEB_ROOT, 'components', 'v2', 'NavMenu.module.css'), 'utf8');
    expect(css).not.toMatch(/\b(animation|transition)\b/);
    expect(css).toMatch(/\.trigger:focus-visible \{[^}]*outline: 2px solid var\(--v2-fg\)/);
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(
      /#[0-9a-f]{3,8}\b|rgba?\(|box-shadow/i,
    );
  });
});

describe('PageShell header', () => {
  const out = renderToStaticMarkup(
    <PageShell nav={MARKETING_NAV}>
      <main>x</main>
    </PageShell>,
  );
  const nav = /<nav [^>]*aria-label="Primary"[^>]*>([\s\S]*?)<\/nav>/.exec(out)?.[1] ?? '';

  it('renders the four top-level items in order, with Learn as the menu button', () => {
    const top = nav
      .replace(/<ul[\s\S]*?<\/ul>/g, '')
      .replace(/<svg[\s\S]*?<\/svg>/g, '')
      .match(/>([^<>]+)</g)
      ?.map((m) => m.slice(1, -1));
    expect(top).toEqual(['Product', 'For agencies', 'Learn', 'Pricing']);
    expect(nav).toMatch(/<button [^>]*aria-expanded="false"[^>]*>Learn/);
  });

  it('renders a planned top-level item as text, never as a dead link', () => {
    expect(nav).toMatch(/<span [^>]*data-v2-planned=""[^>]*>For agencies<\/span>/);
    expect(nav).not.toMatch(/href="#?"/);
  });

  it('still accepts a flat list of links', () => {
    const flat = renderToStaticMarkup(
      <PageShell nav={[{ label: 'Pricing', href: '/pricing' }]}>
        <main>x</main>
      </PageShell>,
    );
    expect(flat).toMatch(
      /<nav [^>]*aria-label="Primary"[^>]*><a href="\/pricing">Pricing<\/a><\/nav>/,
    );
  });
});
