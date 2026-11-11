/**
 * The theme a person picks (CC-26b D10): System, Light or Dark, kept on their own seats. `{theme}`
 * is the whole body; any other field refuses it.
 */
import { ThemeSchema } from '@crawlmouse/types/v2';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

export const ThemeBody = z.strictObject({ theme: ThemeSchema });
export type Theme = z.infer<typeof ThemeSchema>;

/**
 * Sets `theme` on every active seat of `userId`, and only those: the one person's choice applies
 * on each account they sit on.
 */
export async function saveTheme(
  admin: SupabaseClient,
  userId: string,
  theme: Theme,
): Promise<void> {
  const { error } = await admin
    .from('seats')
    .update({ theme })
    .eq('user_id', userId)
    .eq('status', 'active');
  if (error) throw new Error(`theme: seats update failed: ${error.message}`);
}
