import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccountViewer } from '../v2/account/viewer';
import { readPersonTraits, sessionChecksFinished } from './person-read';

vi.mock('server-only', () => ({}));

const viewer = {
  userId: 'u1',
  email: 'someone@example.com',
  seat: { id: 's1', role: 'owner', theme: 'system' },
  account: {
    id: 'a1',
    kind: 'personal',
    name: 'Someone Ltd',
    state: 'pro',
    timezone: 'UTC',
    trialEndsAt: null,
    trialUsedAt: null,
    stateHistory: [{ state: 'pro', since: '2026-11-01T00:00:00Z' }],
  },
} as unknown as AccountViewer;

describe('readPersonTraits', () => {
  it('reads the user, the account state, internal and the check count; no email or name', async () => {
    const internal = vi.fn(async () => true);
    const traits = await readPersonTraits(viewer, {
      checksFinished: async (id) => (id === 'a1' ? 7 : -1),
      internal,
      now: new Date('2026-11-03T00:00:00Z'),
    });
    expect(traits).toEqual({
      userId: 'u1',
      set: {
        account_id: 'a1',
        plan: 'pro',
        internal: true,
        checks_finished: 7,
        account_age_days: 2,
        trial_day: null,
      },
    });
    expect(internal).toHaveBeenCalledWith({ kind: 'account', id: 'a1' });
    expect(JSON.stringify(traits)).not.toMatch(/someone|Someone/);
  });
});

/** A client answering the two reads, recording the filters each was given. */
function fakeSession(siteIds: string[], count: number) {
  const asked: unknown[][] = [];
  const chain = (answer: unknown) => {
    const q = {
      select: (...a: unknown[]) => (asked.push(['select', ...a]), q),
      eq: (...a: unknown[]) => (asked.push(['eq', ...a]), q),
      in: (...a: unknown[]) => (asked.push(['in', ...a]), q),
      then: (ok: (v: unknown) => unknown) => Promise.resolve(answer).then(ok),
    };
    return q;
  };
  const session = {
    from: (table: string) => {
      asked.push(['from', table]);
      return table === 'sites'
        ? chain({ data: siteIds.map((id) => ({ id })), error: null })
        : chain({ data: null, count, error: null });
    },
  } as unknown as SupabaseClient;
  return { session, asked };
}

describe('sessionChecksFinished', () => {
  it("counts the finished and partial checks of the account's sites", async () => {
    const { session, asked } = fakeSession(['s1', 's2'], 4);
    expect(await sessionChecksFinished(session)('a1')).toBe(4);
    expect(asked).toEqual([
      ['from', 'sites'],
      ['select', 'id'],
      ['eq', 'account_id', 'a1'],
      ['from', 'checks'],
      ['select', 'id', { count: 'exact', head: true }],
      ['in', 'site_id', ['s1', 's2']],
      ['in', 'status', ['finished', 'partial']],
    ]);
  });

  it('is 0 for an account with no sites, with no checks read', async () => {
    const { session, asked } = fakeSession([], 9);
    expect(await sessionChecksFinished(session)('a1')).toBe(0);
    expect(asked.filter((a) => a[0] === 'from')).toEqual([['from', 'sites']]);
  });
});
