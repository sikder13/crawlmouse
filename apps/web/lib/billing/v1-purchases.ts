import { checksPublicEnabled } from '../auth/flags';
import { billingV2Enabled } from './flags';

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Whether a new v1 purchase is refused (CC-45 hotfix). While V2_CHECKS_PUBLIC is on, the public product
 * is v2; until V2_BILLING is on, the only checkout is v1's, which sells a v1 entitlement the v2 product
 * does not read. So from public go-live until v2 billing opens, nobody starts a v1 purchase. With both
 * flags off (v1 as it was), and with V2_BILLING on, nothing is refused here.
 *
 * Its own module because lib/auth/flags.ts already imports lib/billing/flags.ts.
 */
export function v1PurchasesClosed(env: Env = process.env): boolean {
  return checksPublicEnabled(env) && !billingV2Enabled(env);
}
