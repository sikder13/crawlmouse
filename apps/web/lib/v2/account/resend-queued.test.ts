/**
 * Row 16 (F-157): the re-send of a queued first check carries the account's page cap, as the first
 * send through `requestCheck` did, rather than the default.
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { accountPageCap } from '../pipeline/page-cap';
import { supabaseResendQueued } from './sites-store';

const SITE = '22222222-2222-4222-8222-222222222222';
const CHECK = '44444444-4444-4444-8444-444444444444';

describe('supabaseResendQueued', () => {
  it("sends the account's page cap", async () => {
    const sent: { data: { pageCap: number } }[] = [];
    const asked: string[] = [];
    const resend = supabaseResendQueued(
      async (accountId) => (asked.push(accountId), 2000),
      async (e) => void sent.push(e as (typeof sent)[number]),
    );
    expect(
      await resend({
        siteId: SITE,
        accountId: 'acct-1',
        host: 'shop.example',
        check: { id: CHECK, trigger: 'first_audit', queued_at: '2026-11-24T12:00:00Z' },
        requestedByUserId: 'user-1',
      }),
    ).toBe(true);
    expect(asked).toEqual(['acct-1']);
    expect(sent.map((e) => e.data.pageCap)).toEqual([2000]);
  });
});

describe('accountPageCap', () => {
  const sbOf = (row: Record<string, unknown>) =>
    ({
      from: () => ({
        select: () => ({ eq: () => ({ single: async () => ({ data: row, error: null }) }) }),
      }),
    }) as unknown as SupabaseClient;
  const clock = {
    past_due_tier: null,
    past_due_since: null,
    trial_variant: null,
    trial_ends_at: null,
  };

  it("reads the account's plan: 2,000 for Pro, 500 for Free", async () => {
    expect(await accountPageCap(sbOf({ state: 'pro', tier: 'pro', ...clock }), 'a')).toBe(2000);
    expect(await accountPageCap(sbOf({ state: 'free', tier: 'free', ...clock }), 'a')).toBe(500);
  });
});
