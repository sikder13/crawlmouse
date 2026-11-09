// @vitest-environment jsdom
/**
 * Q3(b) (CC-V1FIX): after Continue, the page names the account the link signed in and offers to
 * sign out before going on. Someone handed another person's link (login CSRF) sees whose account
 * it is, and "Sign out" ends only this browser's session.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const { signOut, deleted } = vi.hoisted(() => ({
  signOut: vi.fn(async (_opts?: unknown) => ({ error: null })),
  deleted: [] as string[],
}));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => ({ auth: { signOut } }) }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [{ name: 'sb-proj-auth-token', value: 'a' }],
    delete: (name: string) => deleted.push(name),
  }),
}));
vi.mock('posthog-js', () => ({ default: { capture: () => {} } }));

import { ContinueScreen } from '../../components/v2/screens/continue/ContinueScreen';
import { POST as logout } from '../../app/api/auth/logout/route';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  signOut.mockClear();
  deleted.length = 0;
});

async function continueWith(answer: Record<string, unknown>) {
  const assigned: string[] = [];
  vi.stubGlobal('location', { ...window.location, assign: (u: string) => assigned.push(u) });
  vi.stubGlobal('fetch', async () => Response.json(answer));
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
  return { host, assigned };
}

describe('the Continue page after sign-in (Q3)', () => {
  it('names the signed-in address and waits, then goes on when asked', async () => {
    const { host, assigned } = await continueWith({
      next: '/r/abc',
      events: [],
      email: 'ada+work@example.com',
    });
    expect(host.textContent).toContain('Signed in as ada+work@example.com.');
    expect(assigned).toEqual([]);
    const go = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Continue')!;
    act(() => go.click());
    expect(assigned).toEqual(['/r/abc']);
  });

  it('holds the browser to the safe-target rule on the way on, as before', async () => {
    const { host, assigned } = await continueWith({
      next: '//evil.com',
      events: [],
      email: 'ada@example.com',
    });
    expect(assigned).toEqual([]);
    expect(host.textContent).toContain('Signed in as ada@example.com.');
    const go = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Continue')!;
    act(() => go.click());
    expect(assigned).toEqual(['/dashboard']);
  });

  it('renders the address as text, not markup', async () => {
    const { host } = await continueWith({
      next: '/dashboard',
      events: [],
      email: '<img src=x onerror=alert(1)>@example.com',
    });
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>@example.com');
  });

  it("offers 'Not you? Sign out', which posts to the logout route and signs out this browser only", async () => {
    const { host } = await continueWith({
      next: '/dashboard',
      events: [],
      email: 'ada@example.com',
    });
    expect(host.textContent).toContain('Not you?');
    const form = [...host.querySelectorAll('form')].find((f) =>
      f.textContent?.includes('Sign out'),
    )!;
    expect(form.getAttribute('method')).toBe('post');
    expect(form.getAttribute('action')).toBe('/api/auth/logout');

    // The form's target, run: one revoke, scoped to this browser's session, and its cookies cleared.
    const res = await logout(
      new Request(`https://crawlmouse.com${form.getAttribute('action')}`, { method: 'POST' }),
    );
    expect(res.status).toBe(303);
    expect(signOut.mock.calls).toEqual([[{ scope: 'local' }]]);
    expect(deleted).toEqual(['sb-proj-auth-token']);
  });

  it('goes on at once when the answer names no address (an expired link)', async () => {
    const { host, assigned } = await continueWith({
      next: '/login/verify/continue?state=expired',
      events: [],
    });
    expect(assigned).toEqual([]);
    expect(host.textContent).toContain('This link has been used or has expired.');
    expect(host.textContent).not.toContain('Signed in as');
  });
});
