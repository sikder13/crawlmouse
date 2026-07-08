import type { SupabaseClient } from '@supabase/supabase-js';
import { isUndefinedColumnError } from '@/lib/pg-errors';

export interface LeaderboardRow {
  slug: string;
  domain: string;
  grade: string | null;
  score: number | string | null;
}

// SPEC 04 §8/§9 — leaderboard reads. The board is a public surface, so a HIDDEN report must not
// appear (hide is honored everywhere). Deploy-order-safe: prefer the `hidden_at is null` exclusion,
// but fall back to today's query on an undefined-column error (pre-Runbook-B the column is absent —
// and nothing can be hidden yet, since hide 503s without it). A transient error yields the empty/0
// result (never a wrong board).
//
// NOTE: the CLAIMED-only gating (unclaimed → unlisted, §3 guardrail #1 / §8) is Stage C — this helper
// adds ONLY the hide exclusion that must ship alongside hide in Stage B.

function applyBaseFilter<T>(q: T, platform: string): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (q as any).eq('cms_detected', platform).eq('opt_in_leaderboard', true).is('takedown_requested_at', null).not('score', 'is', null);
}

export async function fetchLeaderboardReports(sb: SupabaseClient, platform: string, size: number): Promise<LeaderboardRow[]> {
  const build = (withHidden: boolean) => {
    let q = applyBaseFilter(sb.from('public_reports').select('slug, domain, grade, score'), platform);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (withHidden) q = (q as any).is('hidden_at', null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (q as any).order('score', { ascending: false }).limit(size);
  };
  const first = await build(true);
  if (!first.error) return (first.data as LeaderboardRow[]) ?? [];
  if (isUndefinedColumnError(first.error)) {
    const legacy = await build(false);
    return (legacy.data as LeaderboardRow[]) ?? [];
  }
  return [];
}

export async function countLeaderboardReports(sb: SupabaseClient, platform: string): Promise<number> {
  const build = (withHidden: boolean) => {
    let q = applyBaseFilter(sb.from('public_reports').select('*', { count: 'exact', head: true }), platform);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (withHidden) q = (q as any).is('hidden_at', null);
    return q;
  };
  const first = await build(true);
  if (!first.error) return first.count ?? 0;
  if (isUndefinedColumnError(first.error)) {
    const legacy = await build(false);
    return legacy.count ?? 0;
  }
  return 0;
}
