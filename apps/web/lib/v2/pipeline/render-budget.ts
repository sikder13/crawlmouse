import type { DailyBudget } from '@crawlmouse/engine/v2/pipeline';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Today's browser time for one check, kept in the database (migration 20261123000001). The engine
 * reserves once per render phase, in order, and settles each before the next, so the count of calls
 * names the phase. A retried step makes the same calls in the same order, so it finds its own
 * reservations rather than taking new ones. A database error throws, and the engine records
 * `daily_budget_unavailable`: nothing renders on a budget it could not read.
 */
export function supabaseRenderBudget(sb: SupabaseClient, checkId: string): DailyBudget {
  let phase = 0;
  return {
    async reserve(ms, limitMs) {
      phase += 1;
      const { data, error } = await sb.rpc('reserve_render_ms', {
        p_check: checkId,
        p_phase: phase,
        p_ms: Math.ceil(ms),
        p_limit_ms: Math.floor(limitMs),
      });
      if (error) throw new Error(`render budget: reserve failed: ${error.message}`);
      return data === true;
    },
    async settle(_reservedMs, usedMs) {
      const { error } = await sb.rpc('settle_render_ms', {
        p_check: checkId,
        p_phase: phase,
        p_used_ms: Math.ceil(usedMs),
      });
      if (error) throw new Error(`render budget: settle failed: ${error.message}`);
    },
  };
}
