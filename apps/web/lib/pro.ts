import type { SupabaseClient } from '@supabase/supabase-js';

export function isProActive(proUntil: string | null | undefined, now: Date = new Date()): boolean {
  if (!proUntil) return false;
  return new Date(proUntil).getTime() > now.getTime();
}

export async function userIsPro(sb: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await sb.from('users').select('pro_until').eq('id', userId).maybeSingle();
  return isProActive(data?.pro_until ?? null);
}
