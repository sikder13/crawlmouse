import type { SupabaseClient } from '@supabase/supabase-js';

export interface ParsedResendEvent { eventType: string; email: string; bounceType: 'permanent' | 'transient' | null }

export function parseResendEvent(payload: unknown): ParsedResendEvent {
  const p = (payload ?? {}) as { type?: unknown; data?: { email?: unknown; to?: unknown; bounce?: { type?: unknown } } };
  const eventType = String(p.type ?? '').replace(/^email\./, '');
  const email = String(p.data?.email ?? p.data?.to ?? '');
  const rawBounce = p.data?.bounce?.type;
  const bounceType = rawBounce ? (String(rawBounce).toLowerCase() === 'permanent' ? 'permanent' : 'transient') : null;
  return { eventType, email, bounceType };
}

/** Future transactional sends (v1.1) call this before sending. */
export async function isEmailSuppressed(sb: SupabaseClient, email: string): Promise<boolean> {
  const { data } = await sb.from('email_events').select('id').eq('email_address', email).eq('bounce_type', 'permanent').limit(1);
  return (data?.length ?? 0) > 0;
}
