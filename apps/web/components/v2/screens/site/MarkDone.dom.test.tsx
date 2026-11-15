// @vitest-environment jsdom
/**
 * Mark done's browser event (CC-41 D8, rulings Q11): `fix_done_confirmed {type}` once the route's
 * answer says the mark stands, and never otherwise; the form posts as before while capture is off.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UNQUEUED } from '../../../../lib/v2/account/fixes';
import { action } from '../../../../lib/v2/view/account-actions';
import { LiveActions } from '../account/LiveActions';

const ph = vi.hoisted(() => ({ __loaded: true, optedOut: false, capture: vi.fn() }));
vi.mock('posthog-js', () => ({
  default: {
    get __loaded() {
      return ph.__loaded;
    },
    has_opted_out_capturing: () => ph.optedOut,
    capture: ph.capture,
  },
}));

const { MarkDone, markStood } = await import('./MarkDone');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FIX = '0f8fad5b-d9cb-469f-a165-70867728950e';
const SITE = 'https://crawlmouse.com/sites/s1';
const mark = action('markDone', 'Mark done', { id: FIX }, { context: 'fix 1' });

let root: Root;
let host: HTMLDivElement;
const assign = vi.fn();
const reload = vi.fn();
const nativeSubmit = vi.fn();

function answer(url: string | null, status = 200) {
  const res = { ok: status >= 200 && status < 300, redirected: url !== null, url: url ?? '' };
  return vi.fn(async (_url: string, _init: RequestInit) => res as Response);
}

beforeEach(() => {
  ph.__loaded = true;
  ph.optedOut = false;
  ph.capture.mockClear();
  assign.mockClear();
  reload.mockClear();
  nativeSubmit.mockClear();
  vi.stubGlobal('location', { ...window.location, assign, reload, href: SITE });
  HTMLFormElement.prototype.submit = nativeSubmit;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function click() {
  act(() =>
    root.render(
      <LiveActions>
        <MarkDone action={mark} fixType="orphan_pages" />
      </LiveActions>,
    ),
  );
  let prevented: boolean | null = null;
  const record = (e: Event) => {
    prevented = e.defaultPrevented;
    e.preventDefault(); // jsdom does not navigate
  };
  window.addEventListener('submit', record);
  await act(async () => host.querySelector('button')!.click());
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  window.removeEventListener('submit', record);
  return prevented;
}

describe('MarkDone', () => {
  it('posts the form encoded, captures fix_done_confirmed when the mark stands, and goes to the page', async () => {
    const fetched = answer(`${SITE}?notice=marked_done`);
    vi.stubGlobal('fetch', fetched);
    expect(await click()).toBe(true);
    const [url, init] = fetched.mock.calls[0]!;
    expect(new URL(url).pathname).toBe(mark.href);
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(URLSearchParams);
    expect(ph.capture.mock.calls).toEqual([['fix_done_confirmed', { type: 'orphan_pages' }]]);
    expect(assign).toHaveBeenCalledWith(`${SITE}?notice=marked_done`);
  });

  it.each(['upgrade_required', 'not_markable'])(
    'captures nothing when the route refuses the mark (%s), and still goes to the page',
    async (notice) => {
      vi.stubGlobal('fetch', answer(`${SITE}?notice=${notice}`));
      await click();
      expect(ph.capture).not.toHaveBeenCalled();
      expect(assign).toHaveBeenCalledWith(`${SITE}?notice=${notice}`);
    },
  );

  it('an answer that is not a redirect captures nothing and reloads the page', async () => {
    vi.stubGlobal('fetch', answer(null, 404));
    await click();
    expect([
      ph.capture.mock.calls,
      reload.mock.calls.length,
      nativeSubmit.mock.calls.length,
    ]).toEqual([[], 1, 0]);
  });

  it('a fetch that fails sends the form itself, and captures nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    await click();
    expect([ph.capture.mock.calls, nativeSubmit.mock.calls.length]).toEqual([[], 1]);
  });

  it.each([
    ['capture is opted out', () => (ph.optedOut = true)],
    ['PostHog has not started', () => (ph.__loaded = false)],
  ])('while %s the form posts as before, with no fetch and no event', async (_n, set) => {
    set();
    const fetched = vi.fn();
    vi.stubGlobal('fetch', fetched);
    expect(await click()).toBe(false);
    expect([fetched.mock.calls, ph.capture.mock.calls]).toEqual([[], []]);
  });
});

describe('markStood', () => {
  it('is true for every notice of a mark that stands, and false for the refusals', () => {
    for (const notice of ['marked_done', ...Object.values(UNQUEUED)]) {
      expect(markStood(`${SITE}?notice=${notice}`), notice).toBe(true);
    }
    for (const notice of ['upgrade_required', 'not_markable', '']) {
      expect(markStood(`${SITE}?notice=${notice}`), notice).toBe(false);
    }
    expect(markStood(SITE)).toBe(false);
  });
});
