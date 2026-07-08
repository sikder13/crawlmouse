import type { SupabaseClient } from '@supabase/supabase-js';
import { isUndefinedColumnError } from '@/lib/pg-errors';

export interface LeaderboardRow {
  slug: string;
  domain: string;
  grade: string | null;
  score: number | string | null;
}

// SPEC 04 §8/§9 — leaderboard reads. The board is a public surface, so it lists only CLAIMED,
// non-hidden reports: claim-gating is the §8 "unclaimed → unlisted" guardrail, and hidden reports are
// excluded because hide is honored everywhere. Deploy-order-safe: prefer the `claimed_at`/`hidden_at`
// filters, but fall back to today's query on an undefined-column error (pre-Runbook-B the columns are
// absent — behavior-preserving, since every pre-existing report was minted under mandatory
// verification = claimed, and nothing can be hidden yet). A transient error yields empty/0 (never a
// wrong board), and never falls through to the ungated legacy query.

function applyBaseFilter<T>(q: T, platform: string): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (q as any).eq('cms_detected', platform).eq('opt_in_leaderboard', true).is('takedown_requested_at', null).not('score', 'is', null);
}

// The claimed + non-hidden visibility gate — applied on top of the base filter, absent on the
// pre-migration legacy fallback.
function applyVisibilityGate<T>(q: T): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (q as any).not('claimed_at', 'is', null).is('hidden_at', null);
}

export async function fetchLeaderboardReports(sb: SupabaseClient, platform: string, size: number): Promise<LeaderboardRow[]> {
  const build = (gated: boolean) => {
    let q = applyBaseFilter(sb.from('public_reports').select('slug, domain, grade, score'), platform);
    if (gated) q = applyVisibilityGate(q);
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
  const build = (gated: boolean) => {
    let q = applyBaseFilter(sb.from('public_reports').select('*', { count: 'exact', head: true }), platform);
    if (gated) q = applyVisibilityGate(q);
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
