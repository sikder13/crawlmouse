/**
 * The supabase-js adapters, against a fake PostgREST that answers the way PostgREST does: rows in
 * `data`, a Postgres error's SQLSTATE in `error.code`. The PGlite adapters in __tests__/v2/_lib run
 * the same SQL; these tests pin the mapping that only this adapter has.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sentryReport, supabaseDoorStore } from './stores';
import { MalformedTrialDecisionError, type TrialTransition } from './trial-decision';

type Answer = { data?: unknown; error?: { code?: string; message: string } | null; count?: number };

/** A query builder whose every filter returns itself, and which resolves to the next answer. */
function fakeSb(answers: Answer[]) {
  const calls: { table: string; ops: [string, unknown[]][] }[] = [];
  const rpcs: { fn: string; args: unknown }[] = [];
  const sb = {
    async rpc(fn: string, args: unknown) {
      rpcs.push({ fn, args });
      const answer = answers.shift() ?? { data: null, error: null };
      return { data: answer.data ?? null, error: answer.error ?? null };
    },
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
  return { sb: sb as unknown as SupabaseClient, calls, rpcs };
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

  it('loadMember is null for a user with no default account, and never queries accounts then', async () => {
    const f = fakeSb([{ data: { default_account_id: null } }]);
    await expect(supabaseDoorStore(f.sb).loadMember('u')).resolves.toBeNull();
    expect(f.calls.map((c) => c.table)).toEqual(['users']);
  });

  it('loadMember reads an account only while it is neither deleted nor marked for deletion (spec 27b)', async () => {
    const f = fakeSb([{ data: { default_account_id: 'acc' } }, { data: null }]);
    await expect(supabaseDoorStore(f.sb).loadMember('u')).resolves.toBeNull();
    const accounts = f.calls.find((c) => c.table === 'accounts')!;
    expect(accounts.ops).toContainEqual(['is', ['deleted_at', null]]);
    expect(accounts.ops).toContainEqual(['is', ['deletion_confirmed_at', null]]);
    // No account row: no seat is looked for.
    expect(f.calls.map((c) => c.table)).toEqual(['users', 'accounts']);
  });

  it('a read error throws with its code rather than reading as "nothing there"', async () => {
    const f = fakeSb([{ error: { code: '42501', message: 'permission denied' } }]);
    await expect(supabaseDoorStore(f.sb).loadCheck('c')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('supabaseDoorStore.startTrial', () => {
  const hashes = [{ kind: 'email' as const, value_hash: 'a'.repeat(64) }];
  const transition = { event: 'trial_started', p_account_id: 'acc' } as unknown as TrialTransition;

  it('calls start_trial_with_ledger with the account, the hashes and the transition', async () => {
    const f = fakeSb([{ data: { outcome: 'started', hits: [] } }]);
    await expect(supabaseDoorStore(f.sb).startTrial('acc', hashes, transition)).resolves.toEqual({
      outcome: 'started',
      hits: [],
    });
    expect(f.rpcs).toEqual([
      {
        fn: 'start_trial_with_ledger',
        args: { p_account_id: 'acc', p_hashes: hashes, p_transition: transition },
      },
    ]);
  });

  it('a refusal carries the kinds that refused', async () => {
    const f = fakeSb([{ data: { outcome: 'refused', hits: ['email', 'ip24'] } }]);
    await expect(supabaseDoorStore(f.sb).startTrial('acc', hashes, transition)).resolves.toEqual({
      outcome: 'refused',
      hits: ['email', 'ip24'],
    });
  });

  it('an error throws with its SQLSTATE', async () => {
    const f = fakeSb([{ error: { code: '55P03', message: 'lock timeout' } }]);
    await expect(
      supabaseDoorStore(f.sb).startTrial('acc', hashes, transition),
    ).rejects.toMatchObject({ code: '55P03' });
  });

  it('an answer that is not a decision throws MalformedTrialDecisionError', async () => {
    for (const data of [null, { outcome: 'started' }, { outcome: 'maybe', hits: [] }]) {
      const f = fakeSb([{ data }]);
      await expect(
        supabaseDoorStore(f.sb).startTrial('acc', hashes, transition),
      ).rejects.toBeInstanceOf(MalformedTrialDecisionError);
    }
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
