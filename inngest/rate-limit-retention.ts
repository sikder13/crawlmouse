/**
 * B-F1: rate_limits retention. Calls public.prune_rate_limits, which deletes rows whose window
 * started more than 25 hours ago (the cutoff lives in the SQL, so this loop cannot widen it), in
 * batches until a call deletes fewer than a batch or PRUNE_MAX_CALLS is reached. A second run the
 * same day finds nothing new to delete.
 *
 * Run daily by cleanupExpiredAuditsFn (billing.ts). At the v2 cutover that function retires, and
 * crawlmouse.cleanup.daily must call prune_rate_limits instead (docs/ops/v1-inventory.json).
 */

export const PRUNE_BATCH = 5000;
export const PRUNE_MAX_CALLS = 20;

export interface PruneRpc {
  rpc(
    name: 'prune_rate_limits',
    args: { p_limit: number },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export interface PruneResult {
  deleted: number;
  calls: number;
  /** False when PRUNE_MAX_CALLS ran out first; the next day's run continues. */
  drained: boolean;
}

export async function pruneRateLimits(sb: PruneRpc): Promise<PruneResult> {
  let deleted = 0;
  for (let calls = 1; calls <= PRUNE_MAX_CALLS; calls++) {
    const { data, error } = await sb.rpc('prune_rate_limits', { p_limit: PRUNE_BATCH });
    if (error) throw new Error(`prune_rate_limits failed: ${error.message}`);
    const n = Number(data);
    deleted += n;
    if (n < PRUNE_BATCH) return { deleted, calls, drained: true };
  }
  return { deleted, calls: PRUNE_MAX_CALLS, drained: false };
}
