import type { DailyBudget } from '@crawlmouse/engine/v2/pipeline';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Today's browser time for one execution of a check's render step, kept in the database (migration
 * 20261123000001). The engine reserves once per render phase and settles it before the next, so the
 * reservation it holds is the last one granted. A retried step builds a new budget and takes new
 * reservations, because it spends browser time again. A database error throws, and the engine
 * records `daily_budget_unavailable`: nothing renders on a budget it could not read.
 */
export function supabaseRenderBudget(sb: SupabaseClient, checkId: string): DailyBudget {
  let held: string | null = null;
  return {
    async reserve(ms, limitMs) {
      held = null;
      const { data, error } = await sb.rpc('reserve_render_ms', {
        p_check: checkId,
        p_ms: Math.ceil(ms),
        p_limit_ms: Math.floor(limitMs),
      });
      if (error) throw new Error(`render budget: reserve failed: ${error.message}`);
      if (typeof data !== 'string') return false;
      held = data;
      return true;
    },
    async settle(_reservedMs, usedMs) {
      if (held === null) return;
      // A time that is not a figure leaves the reservation open, so its whole time stays counted.
      if (!(Number.isFinite(usedMs) && usedMs >= 0)) {
        held = null;
        return;
      }
      const { error } = await sb.rpc('settle_render_ms', {
        p_reservation: held,
        p_used_ms: Math.ceil(usedMs),
      });
      if (error) throw new Error(`render budget: settle failed: ${error.message}`);
      held = null;
    },
  };
}
