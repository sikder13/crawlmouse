/**
 * One claim implementation (CC-25 ruling 4): the member route and the sign-in landing both call the
 * `claimCheck` exported by lib/auth/claim.ts. The module is replaced by one spy; each caller is
 * driven once, and the spy must see both calls. A caller with a claim of its own would leave the spy
 * one call short.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
  }),
}));
vi.mock('@/lib/auth/door-deps', () => ({ doorDeps: () => ({ firstLogin: {}, claim: {} }) }));
vi.mock('../../lib/auth/first-login', () => ({
  runFirstLogin: async () => ({ trial: 'not_first', siteId: null, events: [] }),
}));
const { claimCheck } = vi.hoisted(() => ({
  claimCheck: vi.fn(async (..._a: unknown[]) => ({ ok: true, siteId: 's1' })),
}));
vi.mock('../../lib/auth/claim', () => ({ claimCheck }));

import { POST } from '../../app/api/checks/[id]/claim/route';
import { afterSignIn } from '../../lib/auth/landing';
import { claimNext, emailBinding } from '../../lib/auth/continue-intent';

const CHECK = '0b8c6f8e-3c55-4d1b-9a7a-2f0c4f9d6c11';

describe('the claim has one implementation', () => {
  it('the route and the landing both call lib/auth/claim.ts', async () => {
    process.env.V2_ACCOUNT_DOOR = '1';
    try {
      await POST(
        new Request(`https://crawlmouse.com/api/checks/${CHECK}/claim`, { method: 'POST' }),
        {
          params: Promise.resolve({ id: CHECK }),
        },
      );
      await afterSignIn(
        { firstLogin: {} as never, claim: {} as never, report: () => {} },
        {
          user: { id: 'u1', email: 'a@b.co' },
          next: claimNext(CHECK),
          boundTo: emailBinding('a@b.co'),
          signup: null,
          device: null,
          ip: 'unknown',
        },
      );
    } finally {
      delete process.env.V2_ACCOUNT_DOOR;
    }
    expect(claimCheck).toHaveBeenCalledTimes(2);
    expect(claimCheck.mock.calls.map((c) => (c as unknown[])[1])).toEqual([
      { checkId: CHECK, userId: 'u1' },
      { checkId: CHECK, userId: 'u1' },
    ]);
  });
});
