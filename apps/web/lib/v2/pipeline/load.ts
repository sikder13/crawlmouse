/**
 * A persisted check read back as the screens read it (CC-20b D12). Workstream A implements it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CheckDataset, CheckReader } from './types';

export async function loadCheck(_read: CheckReader, _checkId: string): Promise<CheckDataset> {
  throw new Error('loadCheck: workstream A implements this');
}

export function supabaseCheckReader(_sb: SupabaseClient): CheckReader {
  throw new Error('supabaseCheckReader: workstream A implements this');
}
