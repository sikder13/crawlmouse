/**
 * The supabase-js adapters, against a fake PostgREST that answers the way PostgREST does: rows in
 * `data`, a Postgres error's SQLSTATE in `error.code`. The PGlite adapters in __tests__/v2/_lib run
 * the same SQL; these tests pin the mapping that only this adapter has.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import fc from 'fast-check';
import {
  gridSerialize,
  sentryReport,
  SERIALIZE_WINDOW_MS,
  supabaseDoorStore,
  type IncrementCell,
} from './stores';

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

describe('gridSerialize', () => {
  const W = SERIALIZE_WINDOW_MS;
  /** An in-memory increment_rate_limit: one count per (key, window start). */
  function cells() {
    const counts = new Map<string, number>();
    const increment: IncrementCell = async (key, start) => {
      const k = `${key}@${start.toISOString()}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
      return counts.get(k)!;
    };
    return { increment, counts };
  }
  const BOUNDARY = Math.ceil(Date.parse('2026-11-05T12:00:00Z') / W) * W;

  it('refuses the second of two calls a few seconds apart across a window boundary', async () => {
    const { increment } = cells();
    await expect(gridSerialize(increment, () => new Date(BOUNDARY - 2000))('k')).resolves.toBe(
      true,
    );
    await expect(gridSerialize(increment, () => new Date(BOUNDARY + 2000))('k')).resolves.toBe(
      false,
    );
  });

  it('refuses any second call less than half a window after the first, wherever the boundaries fall', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 10 * W }),
        fc.integer({ min: 0, max: W / 2 - 1 }),
        async (t, gap) => {
          const { increment } = cells();
          const at = BOUNDARY + t;
          expect(await gridSerialize(increment, () => new Date(at))('k')).toBe(true);
          expect(await gridSerialize(increment, () => new Date(at + gap))('k')).toBe(false);
        },
      ),
    );
  });

  it('a different key, or a call a full window later in both grids, takes its own slot', async () => {
    const { increment } = cells();
    const at = () => new Date(BOUNDARY + 1000);
    await gridSerialize(increment, at)('k');
    await expect(gridSerialize(increment, at)('other')).resolves.toBe(true);
    await expect(
      gridSerialize(increment, () => new Date(BOUNDARY + 1000 + 2 * W))('k'),
    ).resolves.toBe(true);
  });

  it('a cell the store cannot count refuses', async () => {
    await expect(
      gridSerialize(
        async () => null,
        () => new Date(BOUNDARY),
      )('k'),
    ).resolves.toBe(false);
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
