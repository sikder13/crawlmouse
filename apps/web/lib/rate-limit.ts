import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';

interface CheckResult { allowed: boolean; remaining: number; resetAt: Date }

/**
 * Per-bucket options. The RPC-error behaviour is the only knob:
 *  - default / `failClosed:false` → fail OPEN (don't block legitimate traffic on a transient blip).
 *  - `failClosed:true` → fail CLOSED (deny). Reserve this for a bucket where an uncapped fallback
 *    is worse than a brief outage — the 18%-MRR GLOBAL audit ceiling, where failing open would
 *    silently uncap platform-wide spend during a Supabase blip. Per-IP/domain buckets stay OPEN.
 */
interface CheckOpts { failClosed?: boolean }

export async function checkRateLimit(
  bucketKey: string,
  limit: number,
  windowMs: number,
  opts?: CheckOpts,
): Promise<CheckResult> {
  const sb = supabaseAdmin();
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const resetAt = new Date(windowStart.getTime() + windowMs);

  const { data, error } = await sb.rpc('increment_rate_limit', {
    p_bucket_key: bucketKey,
    p_window_start: windowStart.toISOString(),
  });
  if (error) {
    // The atomic increment RPC is the source of truth. The previous fallback did a
    // read-then-write, which races (concurrent requests both read the same count and
    // each write count+1, so a burst under-counts and slips past the limit). Drop it.
    if (opts?.failClosed) {
      // The caller has declared that an uncapped fallback is unacceptable for this bucket (the
      // global cost ceiling). Deny rather than risk blowing the cost envelope, and log loudly so
      // the deny-on-outage is unmistakable in the logs rather than read as organic capacity.
      console.error(`rate-limit RPC failed for bucket "${bucketKey}" — failing CLOSED (deny): ${error.message}`);
      return { allowed: false, remaining: 0, resetAt };
    }
    // Otherwise fail OPEN on a transient RPC error rather than blocking legitimate traffic, but log
    // loudly so a genuinely broken RPC is caught instead of silently disabling the limit.
    console.error(`rate-limit RPC failed for bucket "${bucketKey}": ${error.message}`);
    return { allowed: true, remaining: limit, resetAt };
  }
  const count = data as number;
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetAt };
}
