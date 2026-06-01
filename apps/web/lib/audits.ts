import type { SupabaseClient } from '@supabase/supabase-js';
import { asNumber } from './numeric';

export interface AuditListItem {
  id: string;
  url: string;
  grade: string | null;
  score: number | null;
  status: string;
  started_at: string;
  completed_at: string | null;
}

/**
 * The current user's audits, freshest first, excluding expired free-tier audits.
 * Single source of truth shared by the dashboard page and the tRPC `listMine`
 * procedure so the two can't drift (the dashboard previously omitted the
 * expires_at filter and listed audits that 404 once the TTL cron deletes them).
 *
 * Relies on RLS to scope rows to the caller. The expires_at value is a
 * server-generated ISO timestamp, never user input, so the .or() string is safe.
 */
export async function listMyAudits(sb: SupabaseClient): Promise<AuditListItem[]> {
  const { data, error } = await sb
    .from('audits')
    .select('id, url, grade, score, status, started_at, completed_at')
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order('started_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []).map((a) => ({ ...a, score: asNumber(a.score) })) as AuditListItem[];
}
