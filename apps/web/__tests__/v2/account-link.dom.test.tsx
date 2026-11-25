// @vitest-environment jsdom
/**
 * D-27: a signed-in person sees "Dashboard", not "Log in", on the public pages. The public pages stay as they were for a stranger: the link renders "Log in" on the
 * server, byte for byte the markup it replaced, and is changed only in the browser, after a check
 * that a stranger (no Supabase auth cookie) does not make at all.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccountLink, mayBeSignedIn, signedIn } from '../../components/v2/AccountLink';
import { Button } from '../../components/v2/Button';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  document.cookie = 'sb-proj-auth-token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const answer = (status: number) => vi.fn(async () => new Response(null, { status }));

async function mount(el: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(el);
  });
  // Let the check's promise settle and its state land.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return host;
}

describe('the server render, as a stranger and a crawler get it', () => {
  it('is the "Log in" button it replaced, byte for byte', () => {
    expect(renderToStaticMarkup(<AccountLink />)).toBe(
      renderToStaticMarkup(
        <Button variant="quiet" href="/login">
          Log in
        </Button>,
      ),
    );
  });
});

describe('mayBeSignedIn: only a Supabase auth cookie starts the check', () => {
  it.each([
    ['', false],
    ['cm_consent=1; region=us', false],
    ['sb-abcd-auth-token=x', true],
    ['a=1; sb-abcd-auth-token.0=x', true],
    ['notsb-abcd-auth-token=x', false],
    // The rule the prerendered header already uses (hasSessionCookie): no empty value, no PKCE
    // verifier, which a signed-out browser can hold.
    ['sb-abcd-auth-token=', false],
    ['sb-abcd-auth-token-code-verifier=x', false],
  ])('%j → %s', (cookie, yes) => {
    expect(mayBeSignedIn(cookie)).toBe(yes);
  });
});

describe('signedIn', () => {
  it('asks nothing without the cookie', async () => {
    const f = answer(200);
    expect(await signedIn(f as unknown as typeof fetch, '')).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('asks the existing signed-in GET, uncached, and reads 200 as signed in', async () => {
    const f = answer(200);
    expect(await signedIn(f as unknown as typeof fetch, 'sb-p-auth-token=x')).toBe(true);
    expect(f).toHaveBeenCalledWith('/api/billing/status', {
      cache: 'no-store',
      credentials: 'same-origin',
    });
  });

  it.each([401, 500])('reads %i as signed out', async (status) => {
    expect(await signedIn(answer(status) as unknown as typeof fetch, 'sb-p-auth-token=x')).toBe(
      false,
    );
  });

  it('reads a failed request as signed out', async () => {
    const f = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await signedIn(f as unknown as typeof fetch, 'sb-p-auth-token=x')).toBe(false);
  });
});

describe('in the browser', () => {
  it('a stranger keeps "Log in", and nothing is asked', async () => {
    const f = answer(200);
    vi.stubGlobal('fetch', f);
    const host = await mount(<AccountLink />);
    expect(host.querySelector('a')!.textContent).toBe('Log in');
    expect(host.querySelector('a')!.getAttribute('href')).toBe('/login');
    expect(f).not.toHaveBeenCalled();
  });

  it('a signed-in person gets "Dashboard"', async () => {
    document.cookie = 'sb-proj-auth-token=x; path=/';
    vi.stubGlobal('fetch', answer(200));
    const host = await mount(<AccountLink />);
    expect(host.querySelector('a')!.textContent).toBe('Dashboard');
    expect(host.querySelector('a')!.getAttribute('href')).toBe('/dashboard');
  });

  it('an expired session keeps "Log in"', async () => {
    document.cookie = 'sb-proj-auth-token=x; path=/';
    vi.stubGlobal('fetch', answer(401));
    const host = await mount(<AccountLink />);
    expect(host.querySelector('a')!.textContent).toBe('Log in');
  });
});

describe('the public pages read no cookie on the server', () => {
  const WEB = join(__dirname, '..', '..');
  it.each([
    'app/page.tsx',
    'app/help/page.tsx',
    'app/help/[slug]/page.tsx',
    'app/not-found.tsx',
    'app/v2-home/page.tsx',
    'components/v2/screens/home/HomeScreen.tsx',
    'components/v2/screens/help/HelpScreens.tsx',
    'components/v2/screens/not-found/NotFoundScreen.tsx',
  ])('%s imports no request cookies or headers', (file) => {
    const src = readFileSync(join(WEB, file), 'utf8');
    expect(src).not.toMatch(/from 'next\/headers'|cookies\(\)|supabaseServer/);
  });

  it('the three screens draw the island, not a fixed "Log in" link', () => {
    for (const file of [
      'components/v2/screens/home/HomeScreen.tsx',
      'components/v2/screens/help/HelpScreens.tsx',
      'components/v2/screens/not-found/NotFoundScreen.tsx',
    ]) {
      const src = readFileSync(join(WEB, file), 'utf8');
      expect(src, file).toContain('<AccountLink />');
      expect(src, file).not.toContain('LOG_IN');
    }
  });
});
