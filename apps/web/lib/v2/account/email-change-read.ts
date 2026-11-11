/**
 * The pages' read of a link row, through the service role (account_tokens has no client grant). It
 * selects the row by its hash and kind and returns the five columns the view needs, nothing else.
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LinkRow, ReadLink } from './email-change-page';

export function readLinkRow(admin: SupabaseClient): ReadLink {
  return async (hash, kind) => {
    const { data, error } = await admin
      .from('account_tokens')
      .select('new_email, old_email, used_at, revoked_at, expires_at')
      .eq('token_hash', hash)
      .eq('kind', kind)
      .maybeSingle();
    if (error) throw new Error(`account_tokens read failed: ${error.code} ${error.message}`);
    return (data as LinkRow | null) ?? null;
  };
}
