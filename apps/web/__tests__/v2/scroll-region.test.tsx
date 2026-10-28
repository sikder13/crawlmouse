// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ScrollRegion } from '../../components/v2/ScrollRegion';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

/**
 * jsdom lays nothing out, so the region's widths are set by hand: `overflows` decides whether its
 * content is wider than it. A child is added afterwards so the region checks again, as a log
 * gaining a line makes it.
 */
function mount() {
  vi.useFakeTimers();
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <ScrollRegion label="Recent fetches">
        <p>line</p>
      </ScrollRegion>,
    ),
  );
  const region = host.querySelector<HTMLElement>('[data-v2-scroll-region]')!;
  let overflows = false;
  Object.defineProperty(region, 'clientWidth', { get: () => 300 });
  Object.defineProperty(region, 'scrollWidth', { get: () => (overflows ? 500 : 300) });
  const change = async (to: boolean) => {
    overflows = to;
    await act(async () => {
      region.appendChild(document.createElement('span'));
      await Promise.resolve();
    });
  };
  return { region, change };
}

describe('ScrollRegion', () => {
  it('joins the tab order while its content overflows, and leaves it when it fits', async () => {
    const { region, change } = mount();
    expect(region.getAttribute('tabindex')).toBeNull();
    await change(true);
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.getAttribute('role')).toBe('region');
    expect(region.getAttribute('aria-label')).toBe('Recent fetches');
    await change(false);
    expect(region.getAttribute('tabindex')).toBeNull();
  });

  it('keeps its tab stop while it holds focus, and lets it go once focus leaves', async () => {
    const { region, change } = mount();
    await change(true);
    act(() => region.focus());
    expect(document.activeElement).toBe(region);
    // The content stops overflowing while focus is in it: focus stays where it is.
    await change(false);
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(document.activeElement).toBe(region);
    // Focus leaves: the region is checked again once the blur is over, with nothing changing.
    act(() => region.blur());
    act(() => {
      vi.runAllTimers();
    });
    expect(region.getAttribute('tabindex')).toBeNull();
  });
});
