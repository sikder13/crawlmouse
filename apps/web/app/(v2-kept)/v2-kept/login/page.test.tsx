/**
 * D-38 (QA's production dashboard walk): `/login` showed the sign-in form to a person already signed
 * in. A signed-in person is sent on, to a safe `next` target or to their dashboard; anyone else gets
 * the form as before.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ user: null as { id: string } | null }));

vi.mock('@/components/layout/Header', () => ({ Header: () => null }));
vi.mock('@/components/layout/Footer', () => ({ Footer: () => null }));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }),
}));

import KeptLoginPage from './page';

const props = (next?: string) =>
  ({ searchParams: Promise.resolve(next === undefined ? {} : { next }) }) as never;

async function redirectOf(next?: string): Promise<string | null> {
  try {
    await KeptLoginPage(props(next));
    return null;
  } catch (error) {
    const digest = String((error as { digest?: unknown }).digest);
    return digest.startsWith('NEXT_REDIRECT') ? digest.split(';')[2]! : digest;
  }
}

beforeEach(() => {
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  h.user = null;
});
afterEach(() => vi.unstubAllEnvs());

describe('/login for a person already signed in (D-38)', () => {
  it('sends them to their dashboard', async () => {
    h.user = { id: 'user-1' };
    expect(await redirectOf()).toBe('/dashboard');
  });

  it('sends them to a same-origin next target, as signing in would have', async () => {
    h.user = { id: 'user-1' };
    expect(await redirectOf('/r/some-report')).toBe('/r/some-report');
  });

  it('never to another origin: an unsafe next goes to the dashboard', async () => {
    h.user = { id: 'user-1' };
    expect(await redirectOf('https://evil.example/')).toBe('/dashboard');
    expect(await redirectOf('//evil.example/')).toBe('/dashboard');
  });

  it('shows anyone signed out the sign-in form, as before', async () => {
    expect(await redirectOf()).toBeNull();
    const html = renderToStaticMarkup(<>{await KeptLoginPage(props())}</>);
    expect(html).toContain('<form');
  });
});
