/**
 * An account's default alert rules (questions Q13), seeded where they are first needed: before alertFn
 * reads the rules it evaluates (alerts-store.ts), and before the Alerts page, a site's page and the
 * Settings pages read them (spec 28 lists the four; `grep -rn "seedDefaultAlertRules\|seedDefaultRules("
 * apps/web/app apps/web/lib --include=*.ts --include=*.tsx | grep -v test`). `seed_default_alert_rules` adds only the kinds the account does not hold, so
 * a rule a member changed stays as they left it. Accounts that existed at migration 028 were seeded by
 * its backfill.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export async function seedDefaultAlertRules(sb: SupabaseClient, accountId: string): Promise<void> {
  const { error } = await sb.rpc('seed_default_alert_rules', { p_account: accountId });
  if (error) throw new Error(`seed_default_alert_rules: ${error.code ?? 'error'}`);
}
