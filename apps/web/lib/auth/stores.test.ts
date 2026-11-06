/**
 * The supabase-js adapters, against a fake PostgREST that answers the way PostgREST does: rows in
 * `data`, a Postgres error's SQLSTATE in `error.code`. The PGlite adapters in __tests__/v2/_lib run
 * the same SQL; these tests pin the mapping that only this adapter has.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { rateLimitSerialize, sentryReport, SERIALIZE_WINDOW_MS, supabaseDoorStore } from './stores';

type Answer = { data?: unknown; error?: { code?: string; message: string } | null; count?: number };

/** A query builder whose every filter returns itself, and which resolves to the next answer. */
function fakeSb(answers: Answer[]) {
  const calls: { table: string; ops: [string, unknown[]][] }[] = [];
  const sb = {
    from(table: string) {
      const call = { table, ops: [] as [string, unknown[]][] };
      calls.push(call);
      const answer = answers.shift() ?? { data: null, error: null };
      const builder: Record<string, unknown> = {};
      for (const op of [
        'select',
        'insert',
        'update',
        'eq',
        'is',
        'in',
        'gt',
        'maybeSingle',
        'single',
      ]) {
        builder[op] = (...args: unknown[]) => {
          call.ops.push([op, args]);
          return builder;
        };
      }
      builder.then = (resolve: (a: Answer) => unknown) =>
        resolve({ data: answer.data ?? null, error: answer.error ?? null, count: answer.count });
      return builder;
    },
  };
  return { sb: sb as unknown as SupabaseClient, calls };
}

describe('supabaseDoorStore', () => {
  it('insertSite reads a unique violation as "already there" and throws anything else', async () => {
    const site = { accountId: 'a', ownerSeatId: 's', host: 'x.com', schedule: null };
    const dupe = fakeSb([{ error: { code: '23505', message: 'duplicate key' } }]);
    await expect(supabaseDoorStore(dupe.sb).insertSite(site)).resolves.toBe('exists');
    const other = fakeSb([{ error: { code: '23514', message: 'check violated' } }]);
    await expect(supabaseDoorStore(other.sb).insertSite(site)).rejects.toMatchObject({
      code: '23514',
    });
  });

  it('takeSite: one row is taken, none is not_unowned, a unique violation is host_kept', async () => {
    const site = { accountId: 'a', ownerSeatId: 's', schedule: null };
    const store = (a: Answer) => supabaseDoorStore(fakeSb([a]).sb);
    await expect(store({ data: [{ id: 'x' }] }).takeSite('x', site)).resolves.toBe('taken');
    await expect(store({ data: [] }).takeSite('x', site)).resolves.toBe('not_unowned');
    await expect(
      store({ error: { code: '23505', message: 'dup' } }).takeSite('x', site),
    ).resolves.toBe('host_kept');
  });

  it('takeSite updates only an unowned site', async () => {
    const f = fakeSb([{ data: [{ id: 'x' }] }]);
    await supabaseDoorStore(f.sb).takeSite('x', {
      accountId: 'a',
      ownerSeatId: 's',
      schedule: null,
    });
    expect(f.calls[0]!.ops).toContainEqual(['is', ['account_id', null]]);
  });

  it('priorLedger keeps only rows whose kind matches the hash it was asked for', async () => {
    const f = fakeSb([
      {
        data: [
          { kind: 'email', value_hash: 'h1', created_at: '2026-11-01T00:00:00Z' },
          { kind: 'device', value_hash: 'h1', created_at: '2026-11-01T00:00:00Z' },
        ],
      },
    ]);
    const rows = await supabaseDoorStore(f.sb).priorLedger(
      [{ kind: 'email', value_hash: 'h1' }],
      new Date('2025-11-05T00:00:00Z'),
    );
    expect(rows).toEqual([{ kind: 'email', created_at: new Date('2026-11-01T00:00:00Z') }]);
    expect(f.calls[0]!.ops).toContainEqual(['gt', ['created_at', '2025-11-05T00:00:00.000Z']]);
  });

  it('loadMember is null for a user with no default account, and never queries accounts then', async () => {
    const f = fakeSb([{ data: { default_account_id: null } }]);
    await expect(supabaseDoorStore(f.sb).loadMember('u')).resolves.toBeNull();
    expect(f.calls.map((c) => c.table)).toEqual(['users']);
  });

  it('a read error throws with its code rather than reading as "nothing there"', async () => {
    const f = fakeSb([{ error: { code: '42501', message: 'permission denied' } }]);
    await expect(supabaseDoorStore(f.sb).loadCheck('c')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('rateLimitSerialize', () => {
  it('takes a bucket of one, fail-closed, for the serialise window', async () => {
    const check = vi.fn(async () => ({ allowed: true }));
    await expect(rateLimitSerialize(check)('trial:email:h')).resolves.toBe(true);
    expect(check).toHaveBeenCalledWith('trial:email:h', 1, SERIALIZE_WINDOW_MS, {
      failClosed: true,
    });
    await expect(rateLimitSerialize(async () => ({ allowed: false }))('k')).resolves.toBe(false);
  });
});

describe('sentryReport', () => {
  it('sends a tagged warning carrying only what it was given', () => {
    const capture = vi.fn();
    sentryReport(capture)('trial-ledger-no-pepper', { accountId: 'acc-1' });
    expect(capture).toHaveBeenCalledWith('auth.trial-ledger-no-pepper', {
      level: 'warning',
      tags: { signal: 'trial-ledger-no-pepper' },
      extra: { accountId: 'acc-1' },
    });
  });
});
