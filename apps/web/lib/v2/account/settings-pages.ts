/**
 * What the live Settings, Settings › Plan, Settings › Delete and Trial ending pages read (CC-27b D6,
 * D8): the caller, the account they act in, their role on it, and that account's records. The role
 * is the session's own `member_role`, read before any service-role read of the account's records.
 */
import 'server-only';
import { supabaseAdmin } from '../../supabase/admin';
import { supabaseServer } from '../../supabase/server';
import { supabaseCheckReader } from '../pipeline/load';
import type { Viewer } from '../view/account';
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
  const { d, billingEnd } = await loadSettingsDataset(
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
  };
}
