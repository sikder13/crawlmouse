import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { ownedAccountId, requestedAccountId } from './owner';

const A = '0b8c6f8e-3c55-4d1b-9a7a-2f0c4f9d6c11';
const B = '7d2f1c4a-9e3b-4b8a-8c1d-5e6f7a8b9c0d';

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
  ['select', 'account_id'],
  ['eq', 'user_id', 'u1'],
  ['eq', 'role', 'owner'],
  ['eq', 'status', 'active'],
];

describe('ownedAccountId', () => {
  it("is the account of the caller's one active owner seat, read with the session", async () => {
    const { sb, calls } = session({ data: [{ account_id: A }], error: null });
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
    const { sb } = session({ data: [{ account_id: A }, { account_id: B }], error: null });
    expect(await ownedAccountId(sb, 'u1')).toEqual({
      ok: false,
      status: 409,
      error: 'account_ambiguous',
    });
  });

  it('throws when the read fails, rather than answering as if there were no seat', async () => {
    const { sb } = session({ data: null, error: { message: 'boom' } });
    await expect(ownedAccountId(sb, 'u1')).rejects.toThrow('seats read failed: boom');
  });
});

describe('requestedAccountId', () => {
  it('is the account the request names, without reading the seats', async () => {
    const { sb, calls } = session({ data: [{ account_id: A }], error: null });
    expect(await requestedAccountId(sb, 'u1', B)).toEqual({ ok: true, accountId: B });
    expect(calls).toEqual([]);
  });

  it("is the caller's owned account when the request names none", async () => {
    const { sb, calls } = session({ data: [{ account_id: A }], error: null });
    expect(await requestedAccountId(sb, 'u1', undefined)).toEqual({ ok: true, accountId: A });
    expect(calls).toEqual(SEATS_READ);
  });
});
