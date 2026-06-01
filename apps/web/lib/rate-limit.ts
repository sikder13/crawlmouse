import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';

interface CheckResult { allowed: boolean; remaining: number; resetAt: Date }

export async function checkRateLimit(
  bucketKey: string,
  limit: number,
  windowMs: number,
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
    // each write count+1, so a burst under-counts and slips past the limit). Drop it:
    // fail OPEN on a transient RPC error rather than blocking legitimate traffic, but log
    // loudly so a genuinely broken RPC is caught instead of silently disabling the limit.
    console.error(`rate-limit RPC failed for bucket "${bucketKey}": ${error.message}`);
    return { allowed: true, remaining: limit, resetAt };
  }
  const count = data as number;
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetAt };
}
