import { describe, it, expect, vi } from 'vitest';

// server.ts is the literal origin of the production 500 (CRAWLMOUSE-7/-8). This guards that it
// WIRES the non-throwing adapter (cookieMethodsFor) into createServerClient — a revert to the old
// inline `setAll` (no try/catch) must fail here. next/headers + @supabase/ssr are mocked because a
// real Next request scope and Supabase client are unavailable in a unit test; the swallowing logic
// under test is the production cookieMethodsFor, not a mock.
vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {
      throw new Error('Cookies can only be modified in a Server Action or Route Handler.');
    },
  }),
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, opts: { cookies: unknown }) => ({ cookies: opts.cookies }),
}));

import { supabaseServer } from './server';

describe('supabaseServer cookie wiring', () => {
  it('wires the non-throwing cookie adapter so a render-context write is swallowed, not thrown', async () => {
    const sb = (await supabaseServer()) as unknown as {
      cookies: { setAll: (c: { name: string; value: string; options: object }[], h: Record<string, string>) => void };
    };
    expect(() =>
      sb.cookies.setAll([{ name: 'sb-x-auth-token', value: 'v', options: {} }], {}),
    ).not.toThrow();
  });
});
