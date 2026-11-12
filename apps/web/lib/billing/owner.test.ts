import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { ownedAccountId, requestedAccountId } from './owner';

const A = '0b8c6f8e-3c55-4d1b-9a7a-2f0c4f9d6c11';
const B = '7d2f1c4a-9e3b-4b8a-8c1d-5e6f7a8b9c0d';
const C = '9a1e2d3c-4b5a-4c6d-8e7f-0a1b2c3d4e5f';

/** The caller's session client: records the seats query, then answers it with `result`. */
function session(result: { data: unknown; error: unknown }) {
  const calls: unknown[][] = [];
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq']) {
    chain[m] = (...args: unknown[]) => {
      calls.push([m, ...args]);
      return chain;
    };
  }
  chain.then = (resolve: (v: unknown) => unknown) => resolve(result);
  const sb = {
    from: (table: string) => {
      calls.push(['from', table]);
      return chain;
    },
  } as unknown as SupabaseClient;
  return { sb, calls };
}

const SEATS_READ = [
  ['from', 'seats'],
  ['select', 'account_id, role'],
  ['eq', 'user_id', 'u1'],
  ['eq', 'status', 'active'],
];

describe('ownedAccountId', () => {
  it("is the account of the caller's one active owner seat, read with the session", async () => {
    const { sb, calls } = session({ data: [{ account_id: A, role: 'owner' }], error: null });
    expect(await ownedAccountId(sb, 'u1')).toEqual({ ok: true, accountId: A });
    expect(calls).toEqual(SEATS_READ);
  });

  it('refuses 403 not_owner without an owner seat (a manager or no seat at all)', async () => {
    const { sb } = session({ data: [], error: null });
    expect(await ownedAccountId(sb, 'u1')).toEqual({
      ok: false,
      status: 403,
      error: 'not_owner',
    });
  });

  it('refuses 409 account_ambiguous with two owner seats', async () => {
    const { sb } = session({
      data: [
        { account_id: A, role: 'owner' },
        { account_id: B, role: 'owner' },
      ],
      error: null,
    });
    expect(await ownedAccountId(sb, 'u1')).toEqual({
      ok: false,
      status: 409,
      error: 'account_ambiguous',
    });
  });

  it('with two owner seats, is the one the switcher names; a choice that is neither stays ambiguous', async () => {
    const two = {
      data: [
        { account_id: A, role: 'owner' },
        { account_id: B, role: 'owner' },
      ],
      error: null,
    };
    expect(await ownedAccountId(session(two).sb, 'u1', B)).toEqual({ ok: true, accountId: B });
    expect(await ownedAccountId(session(two).sb, 'u1', C)).toEqual({
      ok: false,
      status: 409,
      error: 'account_ambiguous',
    });
  });

  it('a choice that is none of the caller’s seats reads as no choice: their one owned account', async () => {
    const { sb } = session({ data: [{ account_id: A, role: 'owner' }], error: null });
    expect(await ownedAccountId(sb, 'u1', C)).toEqual({ ok: true, accountId: A });
  });

  it('acting in an account they sit on and do not own is 403, and never their own account instead', async () => {
    const seats = [
      { account_id: A, role: 'owner' },
      { account_id: C, role: 'account_manager' },
    ];
    expect(await ownedAccountId(session({ data: seats, error: null }).sb, 'u1', C)).toEqual({
      ok: false,
      status: 403,
      error: 'not_owner',
    });
    // Without the choice, the same person's request is about the account they own.
    expect(await ownedAccountId(session({ data: seats, error: null }).sb, 'u1')).toEqual({
      ok: true,
      accountId: A,
    });
  });

  it('a manager or developer elsewhere who owns nothing is 403 with or without a choice', async () => {
    const seats = [{ account_id: C, role: 'developer' }];
    for (const chosen of [null, C]) {
      expect(await ownedAccountId(session({ data: seats, error: null }).sb, 'u1', chosen)).toEqual({
        ok: false,
        status: 403,
        error: 'not_owner',
      });
    }
  });

  it('throws when the read fails, rather than answering as if there were no seat', async () => {
    const { sb } = session({ data: null, error: { message: 'boom' } });
    await expect(ownedAccountId(sb, 'u1')).rejects.toThrow('seats read failed: boom');
  });
});

describe('requestedAccountId', () => {
  it('is the account the request names, without reading the seats', async () => {
    const { sb, calls } = session({ data: [{ account_id: A, role: 'owner' }], error: null });
    expect(await requestedAccountId(sb, 'u1', B)).toEqual({ ok: true, accountId: B });
    expect(calls).toEqual([]);
  });

  it('passes the switcher’s choice on when the request names no account', async () => {
    const { sb } = session({
      data: [
        { account_id: A, role: 'owner' },
        { account_id: B, role: 'owner' },
      ],
      error: null,
    });
    expect(await requestedAccountId(sb, 'u1', undefined, B)).toEqual({ ok: true, accountId: B });
  });

  it("is the caller's owned account when the request names none", async () => {
    const { sb, calls } = session({ data: [{ account_id: A, role: 'owner' }], error: null });
    expect(await requestedAccountId(sb, 'u1', undefined)).toEqual({ ok: true, accountId: A });
    expect(calls).toEqual(SEATS_READ);
  });
});
