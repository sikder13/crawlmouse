/**
 * What the live Settings, Settings › Plan, Settings › Delete and Trial ending pages read (CC-27b D6,
 * D8): the caller, the account they act in (the switcher's choice, as `loadViewer` reads it), their
 * role on it, and that account's records. The role
 * is the session's own `member_role`, read before any service-role read of the account's records.
 */
import 'server-only';
import { ownPersonalAccountId } from '../../billing/owner';
import { supabaseAdmin } from '../../supabase/admin';
import { supabaseServer } from '../../supabase/server';
import { supabaseCheckReader } from '../pipeline/load';
import type { Viewer } from '../view/account';
import type { SeatRole } from './profile';
import { loadSettingsDataset, viewInput } from './settings-dataset';
import { chosenFromRequest, readViewer, type AccountViewer } from './viewer';
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
      /** The accounts of the caller's active seats: what the rail's switcher lists. */
      accounts: AccountViewer['accounts'];
      /**
       * The caller's own personal account: the one their sign-in address and their deletion belong
       * to (docs/specs/v2/31-agency.md §5). It is `viewer.accountId` when that is the account
       * shown; null when the caller's seats name no one such account.
       */
      ownPersonalId: string | null;
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
    await chosenFromRequest(),
  );
  if (found.kind !== 'viewer') return { kind: 'none' };
  const accountId = found.viewer.account.id;
  const { data: role, error } = await session.rpc('member_role', { p_account: accountId });
  if (error) throw new Error(`settings page: member_role failed: ${error.message}`);
  if (role !== 'owner' && role !== 'account_manager' && role !== 'developer')
    return { kind: 'none' };
  const own = found.viewer.account.kind === 'personal' && role === 'owner';
  const personal = own ? null : await ownPersonalAccountId(session, user.id);
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
    accounts: found.viewer.accounts,
    ownPersonalId: own ? accountId : personal?.ok ? personal.accountId : null,
  };
}
