// @vitest-environment jsdom
/**
 * F-045: Sentry is not part of a page's first load. Each case loads this module afresh, with the SDK
 * replaced by one that records when it was fetched and what it was asked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  fetched: 0,
  calls: [] as unknown[][],
}));

const DSN = 'https://public@example.ingest.sentry.io/1';
const settle = () => new Promise((r) => setTimeout(r, 0));
const names = () => h.calls.map((c) => c[0]);

let idle: (() => void) | null;
const added: [string, EventListener][] = [];

async function fresh() {
  vi.resetModules();
  vi.doUnmock('@sentry/nextjs');
  vi.doMock('@sentry/nextjs', () => {
    h.fetched += 1;
    return {
      init: (o: unknown) => void h.calls.push(['init', o]),
      captureException: (e: unknown) => void h.calls.push(['captureException', e]),
      captureRouterTransitionStart: (...a: unknown[]) => void h.calls.push(['transition', ...a]),
    };
  });
  return import('./sentry-lazy');
}

beforeEach(() => {
  h.fetched = 0;
  h.calls.length = 0;
  idle = null;
  vi.stubGlobal('requestIdleCallback', (f: () => void) => {
    idle = f;
    return 1;
  });
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation((t: string, l: unknown, o?: unknown) => {
    added.push([t, l as EventListener]);
    add(t, l as EventListener, o as AddEventListenerOptions);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const [t, l] of added.splice(0)) window.removeEventListener(t, l);
});

describe('the browser’s Sentry', () => {
  it('is not fetched by configuring it or by starting the wait', async () => {
    const s = await fresh();
    s.configureSentry({ dsn: DSN });
    s.startSentryWhenIdle(window);
    await settle();
    expect(h.fetched).toBe(0);
    expect(h.calls).toEqual([]);
  });

  it('is fetched and initialised once, with the options, when the browser is idle', async () => {
    const s = await fresh();
    const options = { dsn: DSN, tracesSampleRate: 0.1 };
    s.configureSentry(options);
    s.startSentryWhenIdle(window);
    idle!();
    await settle();
    await s.loadSentry();
    expect(h.fetched).toBe(1);
    expect(h.calls).toEqual([['init', options]]);
  });

  it('with no DSN nothing is fetched, by any path', async () => {
    const s = await fresh();
    s.configureSentry({ dsn: undefined });
    s.startSentryWhenIdle(window);
    expect(idle).toBeNull();
    s.reportToSentry(new Error('x'));
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('y') }));
    await settle();
    expect(h.fetched).toBe(0);
  });

  it('an error before it has loaded fetches it at once and is reported, after init', async () => {
    const s = await fresh();
    s.configureSentry({ dsn: DSN });
    s.startSentryWhenIdle(window);
    const boom = new Error('early');
    window.dispatchEvent(new ErrorEvent('error', { error: boom }));
    await settle();
    await s.loadSentry();
    await settle();
    expect(names()).toEqual(['init', 'captureException']);
    expect(h.calls[1]![1]).toBe(boom);
  });

  it('a rejected promise before it has loaded is reported', async () => {
    const s = await fresh();
    s.configureSentry({ dsn: DSN });
    s.startSentryWhenIdle(window);
    const event = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(event, 'reason', { value: 'rejected' });
    window.dispatchEvent(event);
    await s.loadSentry();
    await settle();
    expect(h.calls[1]).toEqual(['captureException', 'rejected']);
  });

  it('holds at most ten errors while it loads', async () => {
    const s = await fresh();
    s.configureSentry({ dsn: DSN });
    s.startSentryWhenIdle(window);
    for (let i = 0; i < 25; i++) {
      window.dispatchEvent(new ErrorEvent('error', { error: new Error(`e${i}`) }));
    }
    await s.loadSentry();
    await settle();
    expect(names().filter((n) => n === 'captureException')).toHaveLength(10);
  });

  it('once loaded it leaves errors to the SDK’s own handlers: none is reported twice', async () => {
    const s = await fresh();
    s.configureSentry({ dsn: DSN });
    s.startSentryWhenIdle(window);
    idle!();
    await s.loadSentry();
    await settle();
    h.calls.length = 0;
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('later') }));
    await settle();
    expect(h.calls).toEqual([]);
  });

  it('reportToSentry loads it and captures, in that order', async () => {
    const s = await fresh();
    s.configureSentry({ dsn: DSN });
    const boom = new Error('boundary');
    s.reportToSentry(boom);
    await s.loadSentry();
    await settle();
    expect(names()).toEqual(['init', 'captureException']);
    expect(h.calls[1]![1]).toBe(boom);
  });

  it('a navigation before it has loaded is ignored; after, it is forwarded', async () => {
    const s = await fresh();
    s.configureSentry({ dsn: DSN });
    expect(() => s.routerTransitionStart('/a', 'push')).not.toThrow();
    expect(h.fetched).toBe(0);
    await s.loadSentry();
    s.routerTransitionStart('/b', 'push');
    expect(h.calls.at(-1)).toEqual(['transition', '/b', 'push']);
  });
});
