/**
 * What the live Settings, Settings › Plan, Settings › Delete and Trial ending pages read (CC-27b D6,
 * D8): the caller, the account they act in, their role on it, and that account's records. The role
 * is the session's own `member_role`, read before any service-role read of the account's records.
 */
import 'server-only';
import { supabaseAdmin } from '../../supabase/admin';
import { supabaseServer } from '../../supabase/server';
import { hashMailAddress, mailPepper } from '../mail/address-hash';
import { seedDefaultAlertRules } from '../monitor/alert-defaults';
import { supabaseCheckReader } from '../pipeline/load';
import type { Viewer } from '../view/account';
import type { Undeliverable } from '../view/settings';
import type { SeatRole } from './profile';
import { loadSettingsDataset, viewInput } from './settings-dataset';
import { readViewer } from './viewer';
import type { FixtureDataset } from '@crawlmouse/types/v2';

export type SettingsPageRead =
  | { kind: 'signed_out' }
  /** No account to show: none, or several with no default among them. */
  | { kind: 'none' }
  | {
      kind: 'account';
      userId: string;
      role: SeatRole;
      d: FixtureDataset;
      viewer: Viewer;
      billingEnd: string | null;
      subscriptionStatus: string | null;
      /** The reader's own address when mail to it is suppressed (CC-28 D7), else null. */
      undeliverable: Undeliverable | null;
    };

export async function readSettingsPage(now = new Date()): Promise<SettingsPageRead> {
  const session = await supabaseServer();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return { kind: 'signed_out' };
  const admin = supabaseAdmin();
  const found = await readViewer(
    { session, admin, now: () => now },
    { id: user.id, email: user.email ?? null },
  );
  if (found.kind !== 'viewer') return { kind: 'none' };
  const accountId = found.viewer.account.id;
  const { data: role, error } = await session.rpc('member_role', { p_account: accountId });
  if (error) throw new Error(`settings page: member_role failed: ${error.message}`);
  if (role !== 'owner' && role !== 'account_manager' && role !== 'developer')
    return { kind: 'none' };
  // The account's default alert rules exist before Settings or the trial screen reads them (Q13):
  // trial-ended says whether alerts by email stay on.
  await seedDefaultAlertRules(admin, accountId);
  const { d, billingEnd, subscriptionStatus } = await loadSettingsDataset(
    { session, admin, records: supabaseCheckReader(admin) },
    accountId,
    now,
  );
  return {
    kind: 'account',
    userId: user.id,
    role,
    d: viewInput(d),
    viewer: { accountId, now: now.toISOString() },
    billingEnd,
    subscriptionStatus,
    undeliverable: await suppressionOf(admin, user.email ?? null),
  };
}

/**
 * Whether mail to `address` is suppressed, and why (`email_address_suppressed`, by the mailer's
 * peppered hash). Null for no address, and with no pepper: the hash cannot be made, so nothing can be
 * said either way.
 */
async function suppressionOf(
  admin: ReturnType<typeof supabaseAdmin>,
  address: string | null,
): Promise<Undeliverable | null> {
  const pepper = mailPepper();
  if (address === null || pepper === null) return null;
  const { data, error } = await admin.rpc('email_address_suppressed', {
    p_hash: hashMailAddress(pepper, address),
  });
  if (error) throw new Error(`settings page: email_address_suppressed failed: ${error.message}`);
  return data === 'hard_bounce' || data === 'complaint' ? { address, reason: data } : null;
}
