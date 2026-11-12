/**
 * /pricing behind V2_BILLING (CC-29 D1, D2): the middleware rewrites /pricing here while the flag is
 * on (lib/v2/rewrites.ts). This page is a 404 with the flag off and when the request did not come
 * through the rewrite; it keeps v1's title and canonical; it reads the viewer per request and sends
 * `pricing_viewed` with the request's cookie header.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  rewritten: true,
  reads: 0,
  viewer: { kind: 'signed_out' } as Record<string, unknown>,
  cookie: null as string | null,
  captured: [] as unknown[][],
  after: [] as (() => unknown)[],
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/v2/rewrite-target', () => ({ reachedByRewrite: async () => h.rewritten }));
vi.mock('@/lib/v2/pricing/read', () => ({
  readPricingViewer: async () => {
    h.reads += 1;
    return h.viewer;
  },
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(h.cookie === null ? {} : { cookie: h.cookie }),
}));
vi.mock('next/server', () => ({ after: (fn: () => unknown) => h.after.push(fn) }));
vi.mock('@/lib/analytics-server', () => ({
  captureServerEvent: async (...args: unknown[]) => {
    h.captured.push(args);
  },
}));

import { FREE_START } from '@/lib/billing/state-machine';
import V2PricingPage, { dynamic, metadata } from './page';

const render = (searchParams: Record<string, string> = {}) =>
  V2PricingPage({ searchParams: Promise.resolve(searchParams) }) as Promise<ReactElement>;

beforeEach(() => {
  h.rewritten = true;
  h.reads = 0;
  h.viewer = { kind: 'signed_out' };
  h.cookie = null;
  h.captured = [];
  h.after = [];
  vi.stubEnv('V2_BILLING', '1');
});
afterEach(() => vi.unstubAllEnvs());

describe('/v2-pricing', () => {
  it.each(['', 'true', '0'])('is a 404 with V2_BILLING=%j, before any read', async (flag) => {
    vi.stubEnv('V2_BILLING', flag);
    await expect(render()).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_HTTP_ERROR_FALLBACK;404'),
    });
    expect(h.reads).toBe(0);
  });

  it('with the flag on but not reached through the rewrite, is a 404 before any read', async () => {
    h.rewritten = false;
    await expect(render()).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_HTTP_ERROR_FALLBACK;404'),
    });
    expect(h.reads).toBe(0);
  });

  it('keeps v1’s title and canonical, and renders per request', () => {
    expect(metadata.title).toBe('Pricing');
    expect(metadata.alternates?.canonical).toBe('/pricing');
    expect(metadata.robots).toBeUndefined();
    expect(dynamic).toBe('force-dynamic');
  });

  it('renders the plans for the viewer it reads, on the asked interval', async () => {
    const html = renderToStaticMarkup(await render({ interval: 'year' }));
    expect(h.reads).toBe(1);
    expect(html).toContain('Every audit is free. Pay when you want it watched.');
    expect(html).toContain('$190');
    expect(html).toContain('href="/agency-trial?interval=year"');
  });

  // Q24/Q31: the buttons follow the flags of the routes they reach, read per request. The header's
  // "Log in" is a third /login link either way.
  it.each([
    ['1', 2, 1],
    ['', 0, 3],
  ])('V2_ACCOUNT_DOOR=%j: %i links to /signup, %i to /login', async (door, signup, login) => {
    vi.stubEnv('V2_ACCOUNT_DOOR', door);
    const html = renderToStaticMarkup(await render());
    expect(html.split('href="/signup"').length - 1).toBe(signup);
    expect(html.split('href="/login"').length - 1).toBe(login);
  });

  it('sends pricing_viewed after the response, with the request’s cookie header', async () => {
    h.cookie = 'cm_consent=granted';
    h.viewer = {
      kind: 'signed_in',
      account: { id: 'acct-1', owner: true, tier: 'free', snapshot: FREE_START, customer: null },
      agency: { held: false, used: null },
    };
    await render();
    expect(h.captured).toEqual([]);
    expect(h.after).toHaveLength(1);
    await h.after[0]!();
    expect(h.captured).toEqual([
      [
        'cm_consent=granted',
        {
          event: 'pricing_viewed',
          distinctId: 'account:acct-1',
          properties: { interval: 'month', signedIn: true },
        },
      ],
    ]);
  });
});
