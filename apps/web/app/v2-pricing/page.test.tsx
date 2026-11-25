/**
 * /pricing behind V2_CHECKS_PUBLIC (CC-29 D1, D2; RC-01): the middleware rewrites /pricing here while
 * the flag is on (lib/v2/rewrites.ts). This page is a 404 with the flag off and when the request did not come
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
  userId: null as string | null,
  cookie: null as string | null,
  country: null as string | null,
  captured: [] as unknown[][],
  after: [] as (() => unknown)[],
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/v2/rewrite-target', () => ({ reachedByRewrite: async () => h.rewritten }));
vi.mock('@/lib/v2/pricing/read', () => ({
  readPricingVisit: async () => {
    h.reads += 1;
    return { viewer: h.viewer, userId: h.userId };
  },
}));
vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers({
      ...(h.cookie === null ? {} : { cookie: h.cookie }),
      ...(h.country === null ? {} : { 'x-vercel-ip-country': h.country }),
    }),
}));
vi.mock('next/server', () => ({ after: (fn: () => unknown) => h.after.push(fn) }));
vi.mock('@/lib/analytics-server', () => ({
  captureServerEvent: async (...args: unknown[]) => {
    h.captured.push(args);
  },
  visitorDistinctId: (_cookie: string | null, userId: string | null, fallback: string) =>
    userId ?? `visitor-or-${fallback.split(':')[0]}`,
}));

import { FREE_START } from '@/lib/billing/state-machine';
import { serverCaptureAllowed } from '@/lib/consent';
import V2PricingPage, { dynamic, metadata } from './page';

const render = (searchParams: Record<string, string> = {}) =>
  V2PricingPage({ searchParams: Promise.resolve(searchParams) }) as Promise<ReactElement>;

beforeEach(() => {
  h.rewritten = true;
  h.reads = 0;
  h.viewer = { kind: 'signed_out' };
  h.userId = null;
  h.cookie = null;
  h.country = null;
  h.captured = [];
  h.after = [];
  vi.stubEnv('V2_BILLING', '1');
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  vi.stubEnv('V2_AGENCY_SALES', '1');
});
afterEach(() => vi.unstubAllEnvs());

describe('/v2-pricing', () => {
  it.each(['', 'true', '0'])('is a 404 with both flags at %j, before any read', async (flag) => {
    vi.stubEnv('V2_CHECKS_PUBLIC', flag);
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

  it('passes the Goal 1 switch (V2_HIDE_FEATURES) to the view, read per request', async () => {
    expect(renderToStaticMarkup(await render())).toMatch(/competitor/i);
    vi.stubEnv('V2_HIDE_FEATURES', 'competitors');
    const html = renderToStaticMarkup(await render());
    expect(html).not.toMatch(/competitor/i);
    expect(html).toContain('Every audit is free. Pay when you want it watched.');
  });

  // Q24/Q31: the buttons follow the flags of the routes they reach, read per request. The header's
  // "Log in" is one /login link either way; with the door off Free is another, and Pro's carries `next`.
  it.each([
    ['1', 2, 1],
    ['', 0, 2],
  ])('V2_ACCOUNT_DOOR=%j: %i links to /signup, %i to /login', async (door, signup, login) => {
    vi.stubEnv('V2_ACCOUNT_DOOR', door);
    const html = renderToStaticMarkup(await render());
    expect(html.split('href="/signup"').length - 1).toBe(signup);
    expect(html.split('href="/login"').length - 1).toBe(login);
  });

  it.each([
    ['signed out', { kind: 'signed_out' }],
    [
      'signed in, trial used',
      {
        kind: 'signed_in',
        account: {
          id: 'acct-1',
          owner: true,
          tier: 'free',
          snapshot: { ...FREE_START, trialUsedAt: new Date('2026-10-01T00:00:00Z') },
          customer: 'cus_1',
        },
        agency: { held: false, used: null },
      },
    ],
  ])('RC-01: with billing off, %s, the page offers no paid route', async (_name, viewer) => {
    vi.stubEnv('V2_BILLING', '');
    h.viewer = viewer;
    const html = renderToStaticMarkup(await render());
    expect(html).toContain('Every audit is free. Pay when you want it watched.');
    expect(html).not.toMatch(/api\/billing\/(?:checkout|portal)|agency-trial/);
  });

  // F-251: billing open to everyone, Agency sales closed. The checkout refuses Agency, so the page
  // must not sell it; Pro is sold as normal.
  it.each(['', '0'])(
    'with V2_AGENCY_SALES=%j, the page offers no Agency trial and Pro still sells',
    async (sales) => {
      vi.stubEnv('V2_AGENCY_SALES', sales);
      const html = renderToStaticMarkup(await render({ interval: 'year' }));
      expect(html).not.toContain('agency-trial');
      expect(html).not.toMatch(/day trial, card required|Card on file|Agency trial/i);
      // Pro's own button: its trial, through v1's sign-in (the account door is off here).
      expect(html).toContain('href="/login?next=%2Fpricing%3Finterval%3Dyear"');
      expect(html).toContain('$190');
    },
  );

  it.each([
    ['DE', null, false],
    ['GB', 'cm_consent_required=0', false],
    ['DE', 'cm_consent=granted', true],
    ['DE', 'cm_consent=denied', false],
    ['US', null, true],
  ])(
    'consent for pricing_viewed from %s with cookie %j: allowed %j',
    async (country, cookie, ok) => {
      h.country = country;
      h.cookie = cookie;
      await render();
      await Promise.all(h.after.map((fn) => fn()));
      const sent = h.captured[0]![0] as string | null;
      expect(serverCaptureAllowed(sent)).toBe(ok);
    },
  );

  it('sends pricing_viewed after the response, with the request’s cookie header, keyed by the person', async () => {
    h.cookie = 'cm_consent=granted';
    h.userId = 'user-1';
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
          distinctId: 'user-1',
          accountId: 'acct-1',
          properties: { interval: 'month', signedIn: true },
        },
      ],
    ]);
  });

  it('a signed-out view is keyed by the visitor', async () => {
    await render();
    await h.after[0]!();
    expect(h.captured[0]![1]).toMatchObject({ distinctId: 'visitor-or-anon', accountId: null });
  });
});
