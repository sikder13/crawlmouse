// @vitest-environment jsdom
/**
 * The signed-in segments' error boundaries (CC-33 D5): each reports the error to Sentry, shows the
 * error screen with the event's id, retries by refreshing the route from the server and then
 * resetting the boundary inside one transition, and links support with the mailto the builder makes
 * from the page's path, the ids in it, the event id and the error's digest.
 */
import { act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SUPPORT_COPY } from '../../lib/v2/copy/support';
import { supportMailto } from '../../lib/v2/support/mailto';
import type { SegmentErrorProps } from '../../components/v2/screens/support/SegmentError';

const sentry = vi.hoisted(() => ({ id: '' }));
const nav = vi.hoisted(() => ({ path: '/' }));
const captureException = vi.hoisted(() => vi.fn(() => sentry.id));
const calls = vi.hoisted(() => [] as string[]);
const refresh = vi.hoisted(() => vi.fn(() => void calls.push('refresh')));
vi.mock('@sentry/nextjs', () => ({ captureException }));
// React's own startTransition, with a mark in `calls` before and after the callback runs.
vi.mock('react', async (importOriginal) => {
  const real = await importOriginal<typeof import('react')>();
  return {
    ...real,
    startTransition: (scope: () => void) => {
      calls.push('transition:start');
      real.startTransition(scope);
      calls.push('transition:end');
    },
  };
});
vi.mock('next/navigation', () => ({ usePathname: () => nav.path, useRouter: () => ({ refresh }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SITE = '0b0e7a52-5f0b-4b53-9c0e-0d4a3a1f2c11';
const EVENT = '4f0b6c1d2e3a4b5c6d7e8f9a0b1c2d3e';
const DIGEST = '2384917703';

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  captureException.mockClear();
  refresh.mockClear();
  calls.length = 0;
});

function mount(Boundary: ComponentType<SegmentErrorProps>, props: SegmentErrorProps) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<Boundary {...props} />));
  return host;
}

const BOUNDARIES: [string, string, () => Promise<{ default: ComponentType<SegmentErrorProps> }>][] =
  [
    ['(account)', '/settings', () => import('../../app/(account)/error')],
    ['sites', `/sites/${SITE}`, () => import('../../app/sites/error')],
    ['dashboard/v2', '/dashboard', () => import('../../app/dashboard/v2/error')],
    ['alerts', '/alerts', () => import('../../app/alerts/error')],
    ['changes', '/changes', () => import('../../app/changes/error')],
  ];

describe.each(BOUNDARIES)('app/%s/error.tsx', (_segment, path, load) => {
  it('reports the error, shows its reference, and links support with the builder’s mailto', async () => {
    const { default: Boundary } = await load();
    sentry.id = EVENT;
    nav.path = path;
    const error = Object.assign(new Error('boom'), { digest: DIGEST });
    const host = mount(Boundary, { error, reset: vi.fn() });
    expect(captureException).toHaveBeenCalledWith(error);
    expect(host.querySelectorAll('h1')).toHaveLength(1);
    expect(host.querySelector('h1')!.textContent).toBe(SUPPORT_COPY.error.title);
    expect(host.textContent).toContain(SUPPORT_COPY.error.what);
    expect(host.textContent).toContain(`Reference: ${EVENT}`);
    const link = [...host.querySelectorAll('a')].find(
      (a) => a.textContent === SUPPORT_COPY.error.support,
    )!;
    const expected = supportMailto({
      topic: 'error',
      path,
      ...(path.startsWith('/sites/') ? { siteId: SITE } : {}),
      eventId: EVENT,
      digest: DIGEST,
    });
    expect(link.getAttribute('href')).toBe(expected);
    expect(decodeURIComponent(expected)).toContain(`Reference: ${EVENT}`);
    expect(decodeURIComponent(expected)).toContain(`Server reference: ${DIGEST}`);
  });

  // Next 15's `reset` only clears the boundary's state (next/dist/client/components/
  // error-boundary.js, `this.reset`), so a server component that threw would throw again from the
  // payload the client holds; `router.refresh()` asks the server for the route again first. Both
  // run inside one startTransition: outside it, `reset` is an update of the click's own lane and
  // commits before the refreshed payload does.
  it('retries by refreshing the route from the server, then resetting the boundary, in one transition', async () => {
    const { default: Boundary } = await load();
    sentry.id = EVENT;
    nav.path = path;
    const reset = vi.fn(() => void calls.push('reset'));
    const host = mount(Boundary, { error: new Error('boom'), reset });
    const retry = [...host.querySelectorAll('button')].find(
      (b) => b.textContent === SUPPORT_COPY.error.retry,
    )!;
    expect(calls).toEqual([]);
    act(() => retry.click());
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['transition:start', 'refresh', 'reset', 'transition:end']);
  });

  it('shows no reference while Sentry has given none', async () => {
    const { default: Boundary } = await load();
    sentry.id = '';
    nav.path = path;
    const host = mount(Boundary, { error: new Error('boom'), reset: vi.fn() });
    expect(host.textContent).not.toContain('Reference:');
  });
});
