import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { ownedAccountId, requestedAccountId } from './owner';

const A = '0b8c6f8e-3c55-4d1b-9a7a-2f0c4f9d6c11';
const B = '7d2f1c4a-9e3b-4b8a-8c1d-5e6f7a8b9c0d';

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
  ['select', 'account_id'],
  ['eq', 'user_id', 'u1'],
  ['eq', 'role', 'owner'],
  ['eq', 'status', 'active'],
];
const ok = (data: unknown): Result => ({ data, error: null });

describe('ownedAccountId', () => {
  it("is the account of the caller's one active owner seat, read with the session", async () => {
    const { sb, calls } = session(ok([{ account_id: A }]));
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
  it('with two owner seats, is the personal one, read with the session', async () => {
    const { sb, calls } = session(ok([{ account_id: A }, { account_id: B }]), ok([{ id: A }]));
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
    const { sb } = session(ok([{ account_id: A }, { account_id: B }]), ok(personal));
    expect(await ownedAccountId(sb, 'u1')).toEqual({
      ok: false,
      status: 409,
      error: 'account_ambiguous',
    });
  });

  it('throws when a read fails, rather than answering as if there were no seat', async () => {
    await expect(
      ownedAccountId(session({ data: null, error: { message: 'boom' } }).sb, 'u1'),
    ).rejects.toThrow('seats read failed: boom');
    await expect(
      ownedAccountId(
        session(ok([{ account_id: A }, { account_id: B }]), {
          data: null,
          error: { message: 'down' },
        }).sb,
        'u1',
      ),
    ).rejects.toThrow('accounts read failed: down');
  });
});

describe('requestedAccountId', () => {
  it('is the account the request names, without reading the seats', async () => {
    const { sb, calls } = session(ok([{ account_id: A }, { account_id: B }]), ok([{ id: A }]));
    expect(await requestedAccountId(sb, 'u1', B)).toEqual({ ok: true, accountId: B });
    expect(calls).toEqual([]);
  });

  it("is the caller's owned account when the request names none", async () => {
    const { sb, calls } = session(ok([{ account_id: A }]));
    expect(await requestedAccountId(sb, 'u1', undefined)).toEqual({ ok: true, accountId: A });
    expect(calls).toEqual(SEATS_READ);
  });
});
