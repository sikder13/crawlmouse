import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { ownedAccountId, requestedAccountId } from './owner';

const A = '0b8c6f8e-3c55-4d1b-9a7a-2f0c4f9d6c11';
const B = '7d2f1c4a-9e3b-4b8a-8c1d-5e6f7a8b9c0d';
const C = '9a1e2d3c-4b5a-4c6d-8e7f-0a1b2c3d4e5f';

type Result = { data: unknown; error: unknown };

/** The caller's session client: records each query, then answers it with its table's result. */
function session(seats: Result, accounts: Result = { data: [], error: null }) {
  const calls: unknown[][] = [];
  const sb = {
    from: (table: string) => {
      calls.push(['from', table]);
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in']) {
        chain[m] = (...args: unknown[]) => {
          calls.push([m, ...args]);
          return chain;
        };
      }
      chain.then = (resolve: (v: unknown) => unknown) =>
        resolve(table === 'seats' ? seats : accounts);
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
const ok = (data: unknown): Result => ({ data, error: null });
const owner = (account_id: string) => ({ account_id, role: 'owner' });
const TWO = ok([owner(A), owner(B)]);

describe('ownedAccountId', () => {
  it("is the account of the caller's one active owner seat, read with the session", async () => {
    const { sb, calls } = session(ok([owner(A)]));
    expect(await ownedAccountId(sb, 'u1')).toEqual({ ok: true, accountId: A });
    expect(calls).toEqual(SEATS_READ);
  });

  it('refuses 403 not_owner without an owner seat (a manager or no seat at all)', async () => {
    const { sb } = session(ok([]));
    expect(await ownedAccountId(sb, 'u1')).toEqual({
      ok: false,
      status: 403,
      error: 'not_owner',
    });
  });

  // Q26: the Agency trial gives its person a second owner seat; a request that names no account
  // (Settings' forms, the email change) then acts on their personal account, the default one.
  it('with two owner seats and no choice, is the personal one, read with the session', async () => {
    const { sb, calls } = session(TWO, ok([{ id: A }]));
    expect(await ownedAccountId(sb, 'u1')).toEqual({ ok: true, accountId: A });
    expect(calls.slice(SEATS_READ.length)).toEqual([
      ['from', 'accounts'],
      ['select', 'id'],
      ['in', 'id', [A, B]],
      ['eq', 'kind', 'personal'],
    ]);
  });

  it.each([
    ['none of them personal', []],
    ['two of them personal', [{ id: A }, { id: B }]],
  ])('refuses 409 account_ambiguous with two owner seats and %s', async (_, personal) => {
    const { sb } = session(TWO, ok(personal));
    expect(await ownedAccountId(sb, 'u1')).toEqual({
      ok: false,
      status: 409,
      error: 'account_ambiguous',
    });
  });

  // CC-31 D2b: the account the caller acts in comes before the default.
  it('with two owner seats, is the one the switcher names, though the other is the personal one; a choice that is neither falls to the personal one', async () => {
    const personalA = ok([{ id: A }]);
    const chose = session(TWO, personalA);
    expect(await ownedAccountId(chose.sb, 'u1', B)).toEqual({ ok: true, accountId: B });
    // The choice decided: the accounts were not read.
    expect(chose.calls).toEqual(SEATS_READ);
    expect(await ownedAccountId(session(TWO, personalA).sb, 'u1', C)).toEqual({
      ok: true,
      accountId: A,
    });
    expect(await ownedAccountId(session(TWO).sb, 'u1', C)).toEqual({
      ok: false,
      status: 409,
      error: 'account_ambiguous',
    });
  });

  it('a choice that is none of the caller’s seats reads as no choice: their one owned account', async () => {
    const { sb } = session(ok([owner(A)]));
    expect(await ownedAccountId(sb, 'u1', C)).toEqual({ ok: true, accountId: A });
  });

  it('acting in an account they sit on and do not own is 403, and never their own account instead', async () => {
    const seats = ok([owner(A), { account_id: C, role: 'account_manager' }]);
    expect(await ownedAccountId(session(seats, ok([{ id: A }])).sb, 'u1', C)).toEqual({
      ok: false,
      status: 403,
      error: 'not_owner',
    });
    // Without the choice, the same person's request is about the account they own.
    expect(await ownedAccountId(session(seats).sb, 'u1')).toEqual({ ok: true, accountId: A });
  });

  it('a manager or developer elsewhere who owns nothing is 403 with or without a choice', async () => {
    const seats = ok([{ account_id: C, role: 'developer' }]);
    for (const chosen of [null, C]) {
      expect(await ownedAccountId(session(seats).sb, 'u1', chosen)).toEqual({
        ok: false,
        status: 403,
        error: 'not_owner',
      });
    }
  });

  it('throws when a read fails, rather than answering as if there were no seat', async () => {
    await expect(
      ownedAccountId(session({ data: null, error: { message: 'boom' } }).sb, 'u1'),
    ).rejects.toThrow('seats read failed: boom');
    await expect(
      ownedAccountId(session(TWO, { data: null, error: { message: 'down' } }).sb, 'u1'),
    ).rejects.toThrow('accounts read failed: down');
  });
});

describe('requestedAccountId', () => {
  it('is the account the request names, without reading the seats', async () => {
    const { sb, calls } = session(TWO, ok([{ id: A }]));
    expect(await requestedAccountId(sb, 'u1', B)).toEqual({ ok: true, accountId: B });
    expect(calls).toEqual([]);
  });

  it('passes the switcher’s choice on when the request names no account', async () => {
    const { sb } = session(TWO, ok([{ id: A }]));
    expect(await requestedAccountId(sb, 'u1', undefined, B)).toEqual({ ok: true, accountId: B });
  });

  it("is the caller's owned account when the request names none", async () => {
    const { sb, calls } = session(ok([owner(A)]));
    expect(await requestedAccountId(sb, 'u1', undefined)).toEqual({ ok: true, accountId: A });
    expect(calls).toEqual(SEATS_READ);
  });
});
