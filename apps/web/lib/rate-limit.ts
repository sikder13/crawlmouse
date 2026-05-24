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
    // Fallback if RPC missing
    const { data: existing } = await sb
      .from('rate_limits')
      .select('request_count')
      .eq('bucket_key', bucketKey)
      .eq('window_start', windowStart.toISOString())
      .maybeSingle();
    const newCount = (existing?.request_count ?? 0) + 1;
    await sb.from('rate_limits').upsert({ bucket_key: bucketKey, window_start: windowStart.toISOString(), request_count: newCount });
    return { allowed: newCount <= limit, remaining: Math.max(0, limit - newCount), resetAt };
  }
  const count = data as number;
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetAt };
}
