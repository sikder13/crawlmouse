// @vitest-environment jsdom
/**
 * The sign-in link's token appears in no URL the browser shows, no HTML the Continue page renders and
 * no PostHog payload (CC-25 ruling 3). The walk follows a real sign-in through the real route
 * handlers and the real page: GET /login/verify with the token, the page it redirects to, the
 * Continue click, the JSON answer, the events it fires and the navigation that ends it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

const CANARY = 'tok_LEAKCANARY_9d1e7c3b5a';

vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    auth: {
      verifyOtp: async ({ token_hash }: { token_hash: string }) =>
        token_hash === CANARY
          ? {
              data: {
                user: {
                  id: 'u1',
                  email: 'ada@example.com',
                  email_confirmed_at: '2026-11-05T12:00:00Z',
                  last_sign_in_at: '2026-11-05T12:00:00Z',
                },
              },
              error: null,
            }
          : { data: { user: null }, error: { status: 403, code: 'otp_expired' } },
      exchangeCodeForSession: vi.fn(),
      getUser: async () => ({ data: { user: null } }),
    },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('@/lib/anon-session', () => ({
  readAnonSessionId: async () => null,
  clearAnonSession: async () => {},
}));
vi.mock('@/lib/auth/door-deps', () => ({ doorDeps: () => ({ firstLogin: {}, claim: {} }) }));
vi.mock('@/lib/auth/landing', () => ({
  afterSignIn: async () => ({
    dest: null,
    events: [
      { name: 'trial_started', props: { kind: 'pro', variant: 'no_card' } },
      { name: 'site_added', props: { n: 1 } },
    ],
  }),
}));
const captured: unknown[] = [];
vi.mock('posthog-js', () => ({
  default: { capture: (...args: unknown[]) => captured.push(args) },
}));

import { GET, POST } from '../../app/login/verify/route';
import ContinuePage from '../../app/(account)/login/verify/continue/page';
import { ContinueScreen } from '../../components/v2/screens/continue/ContinueScreen';
import { DASHBOARD } from '../../lib/auth/continue-intent';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const ORIGIN = 'https://crawlmouse.com';

let root: Root | null = null;
beforeEach(() => {
  process.env.V2_ACCOUNT_DOOR = '1';
  captured.length = 0;
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  delete process.env.V2_ACCOUNT_DOOR;
  vi.unstubAllGlobals();
});

describe('the sign-in token', () => {
  it('appears in no URL, no rendered HTML and no PostHog payload', async () => {
    const seen: string[] = [];

    // 1. The email link.
    const landing = await GET(
      new Request(`${ORIGIN}/login/verify?token_hash=${CANARY}&type=magiclink`),
    );
    const location = landing.headers.get('location')!;
    seen.push(location);
    // Every header but the cookie itself. `x-middleware-set-cookie` is Next's internal copy of
    // Set-Cookie, which Next strips before the response leaves the server.
    const COOKIE_HEADERS = new Set(['set-cookie', 'x-middleware-set-cookie']);
    for (const [name, value] of landing.headers) if (!COOKIE_HEADERS.has(name)) seen.push(value);
    const jar = landing.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');

    // 2. The page it lands on, rendered by the server.
    const page = await ContinuePage({ searchParams: Promise.resolve({}) });
    seen.push(renderToStaticMarkup(page));

    // 3. The Continue click, in the browser, answered by the real POST handler.
    const assigned: string[] = [];
    vi.stubGlobal('location', { ...window.location, assign: (u: string) => assigned.push(u) });
    vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
      const res = await POST(
        new Request(new URL(input, ORIGIN), {
          ...init,
          headers: { ...(init.headers as Record<string, string>), origin: ORIGIN, cookie: jar },
        }),
      );
      seen.push(await res.clone().text());
      return res;
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<ContinueScreen state="idle" />));
    seen.push(host.innerHTML);
    await act(async () => {
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    // The walk reached the end: the events fired and the browser was sent on.
    expect(assigned).toEqual(['/dashboard']);
    expect(captured).toEqual([
      ['trial_started', { kind: 'pro', variant: 'no_card' }],
      ['site_added', { n: 1 }],
    ]);
    seen.push(JSON.stringify(captured), ...assigned, document.location.href, host.innerHTML);

    // The token was really carried (the canary is in the cookie), and nowhere else.
    expect(jar).toContain('LEAKCANARY');
    for (const [i, text] of seen.entries()) expect(`${i}: ${text}`).not.toContain('LEAKCANARY');
    expect(new URL(location).search).toBe('');
  });
});

describe('the Continue page’s navigation', () => {
  async function continueTo(next: string): Promise<string[]> {
    const assigned: string[] = [];
    vi.stubGlobal('location', { ...window.location, assign: (u: string) => assigned.push(u) });
    vi.stubGlobal('fetch', async () => Response.json({ next, events: [] }));
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<ContinueScreen state="idle" />));
    await act(async () => {
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    act(() => root?.unmount());
    root = null;
    return assigned;
  }

  it('refuses a target the server rule refuses (//host, /\\host, absolute, dot segments), and goes to the dashboard', async () => {
    for (const evil of ['//evil.com', '/\\evil.com', 'https://evil.com', '/.//evil.com']) {
      expect(await continueTo(evil), evil).toEqual([DASHBOARD]);
    }
  });

  it('follows a same-origin path as sent', async () => {
    expect(await continueTo('/r/abc?x=1')).toEqual(['/r/abc?x=1']);
  });
});
