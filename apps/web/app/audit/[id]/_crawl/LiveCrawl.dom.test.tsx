// @vitest-environment jsdom
/**
 * The crawl screen of a real check in a browser: it draws what the stream sends, says when the
 * stream is out of reach, and its two controls call the cancel and notify routes.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { frame } from '../../../api/checks/[id]/stream/serve';
import { START, type Cursor } from '../../../../lib/v2/pipeline/stream';
import type { ProgressEvent } from '../../../../lib/v2/progress';
import { LIVE_EMAIL_DOES, LiveCrawl, retryDelayMs } from './LiveCrawl';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CHECK = '0b0e7a52-5f0b-4b53-9c0e-0d4a3a1f2c11';

/** An EventSource the test drives: what the browser would do is done by hand. */
class FakeEventSource {
  static CLOSED = 2;
  static made: FakeEventSource[] = [];
  readyState = 0;
  lastEventId = '';
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string; lastEventId: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeEventSource.made.push(this);
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
  /** The server's text for one group arrives. */
  send(events: ProgressEvent[], cursor: Cursor) {
    for (const block of frame(events, cursor).split('\n\n').filter(Boolean)) {
      const lines = block.split('\n');
      const id = lines.find((l) => l.startsWith('id: '));
      if (id) this.lastEventId = id.slice(4);
      const data = lines.find((l) => l.startsWith('data: '))!.slice(6);
      this.onmessage?.({ data, lastEventId: this.lastEventId });
    }
  }
  /** The connection drops and the browser retries by itself. */
  drop() {
    this.readyState = 0;
    this.onerror?.();
  }
  /** The server answered the connection with an error status. */
  refuse() {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.();
  }
}

let root: Root | null = null;
let host: HTMLElement;
const fetched: { url: string; init: RequestInit }[] = [];
let answer = { status: 200 };

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'],
  });
  FakeEventSource.made = [];
  fetched.length = 0;
  answer = { status: 200 };
  refresh.mockClear();
  vi.stubGlobal('EventSource', FakeEventSource);
  // jsdom has no CSS.escape and no Web Animations; the map and the entering elements use them.
  vi.stubGlobal('CSS', { escape: (v: string) => v.replace(/["\\]/g, '\\$&') });
  Element.prototype.animate = (() => ({
    cancel: () => undefined,
    finished: Promise.resolve(),
  })) as unknown as Element['animate'];
  // Nor does it lay out SVG: the map falls back to one unit a pixel.
  (SVGElement.prototype as unknown as { getScreenCTM: () => null }).getScreenCTM = () => null;
  // jsdom has no matchMedia; the map asks it whether its panels are drawn over it.
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    fetched.push({ url, init });
    return new Response('{}', answer);
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<LiveCrawl checkId={CHECK} host="shop.example" />));
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const text = () => host.textContent ?? '';
const notices = () =>
  [...host.querySelectorAll('[data-v2-live-notices] p')].map((p) => p.textContent);
const source = () => FakeEventSource.made.at(-1)!;
const settle = () => act(async () => void (await Promise.resolve()));

const crawling: { events: ProgressEvent[]; cursor: Cursor } = {
  events: [
    {
      type: 'page_fetched',
      at_ms: 500,
      url: 'https://shop.example/',
      identity: 'UA',
      purpose: 'crawl',
      status: 200,
      ms: 80,
      links: 4,
    },
    { type: 'stage', at_ms: 9000, phase: 'robots_and_sitemap', state: 'now' },
    { type: 'stage', at_ms: 9000, phase: 'robots_and_sitemap', state: 'done' },
    { type: 'stage', at_ms: 9000, phase: 'homepage', state: 'now' },
    { type: 'stage', at_ms: 9000, phase: 'homepage', state: 'done' },
    { type: 'stage', at_ms: 9000, phase: 'crawl', state: 'now' },
    { type: 'counts', at_ms: 9000, pages_crawled: 3, links_found: 12 },
  ],
  cursor: { ...START, batch: 1, step: 5, pages: 3, links: 12, at: 9000 },
};

describe('LiveCrawl', () => {
  it('opens the check’s stream and draws what it sends', () => {
    expect(FakeEventSource.made.map((s) => s.url)).toEqual([`/api/checks/${CHECK}/stream`]);
    expect(text()).toContain('shop.example');
    expect(text()).toContain('Starting');
    act(() => source().send(crawling.events, crawling.cursor));
    expect(text()).toContain('Crawling');
    expect(text()).toContain('3 pages');
    expect(text()).toContain('12 links found so far');
    expect(text()).toContain('0:09 elapsed');
    // One of the three pages fetched is drawn: the screen says what its map leaves out.
    expect(notices()).toEqual(['The map shows 1 of the 3 pages fetched so far.']);
    // No verdict is streamed, so no crawler panel is drawn.
    expect(host.querySelector('[data-v2-verdicts]')).toBeNull();
  });

  it('ticks the clock between events', () => {
    act(() => source().send(crawling.events, crawling.cursor));
    act(() => void vi.advanceTimersByTime(3000));
    expect(text()).toContain('0:12 elapsed');
  });

  it('asks the page again when the check ends, and stops following', () => {
    act(() => source().send(crawling.events, crawling.cursor));
    expect(refresh).not.toHaveBeenCalled();
    act(() =>
      source().send([{ type: 'ended', at_ms: 20_000, status: 'failed' }], {
        ...crawling.cursor,
        at: 20_000,
        ended: true,
      }),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(source().readyState).toBe(FakeEventSource.CLOSED);
    expect(text()).toContain('Audit stopped');
  });

  it('keeps its state through a dropped connection the browser retries', () => {
    act(() => source().send(crawling.events, crawling.cursor));
    act(() => source().drop());
    expect(FakeEventSource.made).toHaveLength(1);
    expect(text()).toContain('3 pages');
    expect(notices()).toEqual(['The map shows 1 of the 3 pages fetched so far.']);
  });

  const LOST =
    'The live view lost its connection, and is trying again. The audit keeps running; the counts here are the last received.';

  it('says so when the server refuses the stream, keeps the last counts, and tries again later', () => {
    act(() => source().send(crawling.events, crawling.cursor));
    act(() => source().refuse());
    expect(notices()[0]).toBe(LOST);
    expect(text()).toContain('3 pages');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(FakeEventSource.made).toHaveLength(1);
    act(() => void vi.advanceTimersByTime(retryDelayMs(1)));
    expect(FakeEventSource.made).toHaveLength(2);
    expect([1, 2, 3, 4, 5, 9].map(retryDelayMs)).toEqual([
      5000, 10_000, 20_000, 40_000, 60_000, 60_000,
    ]);
  });

  it('a retry the server refuses again leaves the last counts on the screen', () => {
    act(() => source().send(crawling.events, crawling.cursor));
    act(() => source().refuse());
    act(() => void vi.advanceTimersByTime(retryDelayMs(1)));
    // The retry is under way, and then refused: nothing was sent, so nothing is taken away.
    expect(text()).toContain('3 pages');
    act(() => source().refuse());
    expect(FakeEventSource.made).toHaveLength(2);
    expect(text()).toContain('3 pages');
    expect(text()).not.toContain('Starting');
    expect(notices()[0]).toBe(LOST);
  });

  it('starts over when a retry opens, and not when the browser reconnects by itself', () => {
    act(() => source().send(crawling.events, crawling.cursor));
    act(() => source().refuse());
    act(() => void vi.advanceTimersByTime(retryDelayMs(1)));
    // The new connection sent no last event id: once it opens, the server sends the run again.
    act(() => source().onopen?.());
    expect(text()).toContain('Starting');
    expect(text()).not.toContain('3 pages');
    expect(notices()).toEqual([]);
    act(() => source().send(crawling.events, crawling.cursor));
    expect(notices()).toEqual(['The map shows 1 of the 3 pages fetched so far.']);
    // The browser's own reconnect sends the last id, so what is drawn stays.
    act(() => source().drop());
    act(() => source().onopen?.());
    expect(text()).toContain('3 pages');
    expect(FakeEventSource.made).toHaveLength(2);
  });

  it('Cancel posts to the cancel route and asks the page again', async () => {
    const cancel = [...host.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Cancel this audit'),
    )!;
    act(() => cancel.click());
    await settle();
    expect(fetched).toEqual([{ url: `/api/checks/${CHECK}/cancel`, init: { method: 'POST' } }]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(notices()).toEqual([]);
  });

  it('says when a cancel did not go through', async () => {
    answer = { status: 500 };
    const cancel = [...host.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Cancel this audit'),
    )!;
    act(() => cancel.click());
    await settle();
    await settle();
    expect(notices()).toEqual(['The audit could not be cancelled. Try again.']);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('the email ask posts the address to the notify route and confirms once it is stored', async () => {
    expect(text()).toContain(LIVE_EMAIL_DOES);
    expect(text()).not.toContain('30 days');
    const input = host.querySelector<HTMLInputElement>('input[name="email"]')!;
    const form = input.closest('form')!;
    const submit = async (value: string) => {
      input.value = value;
      act(() => void form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      await settle();
      await settle();
    };
    answer = { status: 429 };
    await submit('dana@example.com');
    expect(text()).toContain('Too many addresses were sent from here today.');
    expect(text()).not.toContain('address noted');
    answer = { status: 409 };
    await submit('dana@example.com');
    expect(text()).toContain('This audit has already ended.');
    answer = { status: 200 };
    await submit('dana@example.com');
    expect(text()).toContain('address noted');
    expect(fetched.at(-1)).toEqual({
      url: `/api/checks/${CHECK}/notify`,
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"email":"dana@example.com"}',
      },
    });
  });
});
