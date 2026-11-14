import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('server-only', () => ({}));

import {
  consoleAdmin,
  requireOperator,
  type OperatorProof,
  type OperatorSession,
} from './operator';

/** A session stand-in: the user `getUser()` answers, what `is_operator` answers, and the calls. */
function session(
  user: { id: string } | null,
  answer: { data: unknown; error?: { message: string } },
) {
  const calls: string[] = [];
  const s: OperatorSession = {
    auth: {
      getUser: async () => {
        calls.push('getUser');
        return { data: { user } };
      },
    },
    rpc: async (fn) => {
      calls.push(`rpc(${fn})`);
      return { data: answer.data, error: answer.error ?? null };
    },
  };
  return { s, calls };
}

const USER = { id: '6f1c2a8e-0000-4000-8000-000000000001' };

describe('requireOperator', () => {
  it('asks getUser, then is_operator, and answers the user id for a strict true', async () => {
    const { s, calls } = session(USER, { data: true });
    const proof = await requireOperator(s);
    expect(proof?.userId).toBe(USER.id);
    expect(calls).toEqual(['getUser', 'rpc(is_operator)']);
  });

  it('answers null with no session, and does not ask is_operator', async () => {
    const { s, calls } = session(null, { data: true });
    expect(await requireOperator(s)).toBeNull();
    expect(calls).toEqual(['getUser']);
  });

  it.each([false, null, 'true', 1, {}, [true]])(
    'answers null when is_operator answers %j',
    async (data) => {
      const { s } = session(USER, { data });
      expect(await requireOperator(s)).toBeNull();
    },
  );

  it('answers null, and logs, when is_operator errors', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { s } = session(USER, { data: true, error: { message: 'boom' } });
    expect(await requireOperator(s)).toBeNull();
    expect(log).toHaveBeenCalledWith('ops: is_operator failed: boom');
    log.mockRestore();
  });
});

describe('consoleAdmin', () => {
  const client = {} as SupabaseClient;

  it('makes the client for a proof requireOperator issued', async () => {
    const { s } = session(USER, { data: true });
    const proof = (await requireOperator(s))!;
    const make = vi.fn(() => client);
    expect(consoleAdmin(proof, make)).toBe(client);
    expect(make).toHaveBeenCalledOnce();
  });

  it('refuses a cast object, and makes nothing', () => {
    const make = vi.fn(() => client);
    const forged = { userId: USER.id } as unknown as OperatorProof;
    expect(() => consoleAdmin(forged, make)).toThrow(/not a proof requireOperator issued/);
    expect(() => consoleAdmin(null as unknown as OperatorProof, make)).toThrow();
    expect(make).not.toHaveBeenCalled();
  });

  it('a proof cannot be built from a plain object: the type says so', () => {
    // @ts-expect-error — an object without the brand is not an OperatorProof.
    const p: OperatorProof = { userId: USER.id };
    expect(p.userId).toBe(USER.id);
  });
});
