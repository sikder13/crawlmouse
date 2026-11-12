/**
 * Deleting an account (D4): the request, the confirmation link's POST and the restore link's POST,
 * over ports. The rules and every write are the SQL of migration 20261112000002 section B
 * (`request_account_deletion`, `confirm_account_deletion`, `read_deletion_link`, `restore_account`);
 * this module adds what SQL cannot do: the Auth ban, the emails, the events, and the Inngest event that
 * ends the subscription.
 *
 * The Auth ban follows the pending_erasures row. Confirm: the SQL confirm (marks the accounts,
 * queues the person, ends their sessions); then the ban (`banAfterConfirm`), which a failure only
 * reports, because the purge bans again before it erases; then one `account.deletion_confirmed` per
 * marked account. Restore: the link is read, the SQL restore consumes the token and clears the row,
 * and then the ban is lifted (`unbanAfterRestore`). A restore whose answer is lost is judged by
 * `erasure_state`: still pending (it did not commit, so the error is thrown), restored, or erased by
 * the purge in between.
 * A subscription the deletion set to end is resumed by `account.restored` (deletionResumeFn).
 */
import type { Tier } from '../../entitlement-v2';
import type { CaptureAccountEvent } from './account-events';
import { accountEmail, type SendEmails } from './emails';
import { ipHash } from './rate-keys';
import { hashToken } from './tokens';

/** A service-role RPC: the function's JSON answer, or a throw. */
export type Rpc = <T>(fn: string, args: Record<string, unknown>) => Promise<T>;

/** The two Inngest events this module sends. */
export type DeletionEvent =
  | { name: 'account.deletion_confirmed'; data: { userId: string; accountId: string } }
  | { name: 'account.restored'; data: { userId: string; subscriptionIds: string[] } };

export interface DeletionPorts {
  rpc: Rpc;
  auth: { ban(userId: string): Promise<void>; unban(userId: string): Promise<void> };
  send(events: readonly DeletionEvent[]): Promise<void>;
  sendEmails: SendEmails;
  capture: CaptureAccountEvent;
  /** Counts one use of `bucket` against `limit` a day; false when over it, or when it cannot count. */
  rateLimit(bucket: string, limit: number): Promise<boolean>;
  /** Sentry: an error and the user id it concerns, nothing else. */
  report(error: unknown, userId: string): void;
  now(): Date;
}

export type DeletionAnswer = { ok: true } | { ok: false; status: number; code: string };

/** Requests a day: per person, and per IP address. */
export const DELETE_REQUESTS_PER_USER = 3;
export const DELETE_REQUESTS_PER_IP = 10;

/** Auth ban attempts at confirm: the first and two retries. */
export const BAN_ATTEMPTS = 3;

const STATUS: Readonly<Record<string, number>> = {
  hostname_mismatch: 422,
  others_seated: 409,
  v1_subscription: 409,
  email_change_pending: 409,
  invalid_link: 410,
  already_confirmed: 409,
  not_confirmed: 409,
  window_closed: 410,
};

function refusal(code: string): DeletionAnswer {
  const status = STATUS[code];
  if (status === undefined) throw new Error(`deletion: an unknown refusal code ${code}`);
  return { ok: false, status, code };
}

type Refused = { ok: false; code: string };

export interface DeletionRequest {
  userId: string;
  accountId: string;
  /** What the owner typed: the primary site's host, or the sign-in address with no site. */
  hostname: string;
  /** The client's address, or null when it is not known (then only the per-person limit applies). */
  ip: string | null;
}

/**
 * The owner's request (`DELETE /api/account`): deletes nothing. The caller has established, through
 * the caller's own session, that `userId` is the account's owner; the SQL checks it again.
 */
export async function requestAccountDeletion(
  ports: DeletionPorts,
  input: DeletionRequest,
): Promise<DeletionAnswer> {
  // The person's bucket ends with `:<user id>`, so the erasure's rate-limit rule removes it with the
  // person. The address's bucket ends with the address's sha256 (`ipHash`, as the email change's does):
  // the erasure cannot tie it to anyone, and `prune_rate_limits` deletes it 25 hours after its window.
  const allowed =
    (await ports.rateLimit(`account:delete:user:${input.userId}`, DELETE_REQUESTS_PER_USER)) &&
    (input.ip === null ||
      (await ports.rateLimit(`account:delete:ip:${ipHash(input.ip)}`, DELETE_REQUESTS_PER_IP)));
  if (!allowed) return { ok: false, status: 429, code: 'rate_limited' };

  // The links' rows hold no token until CC-28's mailer issues them (owner ruling Q5): the email names
  // the confirmation row, and issuing it issues the restore row paired with it.
  const r = await ports.rpc<Refused | { ok: true; confirmTokenId: string; tier: Tier }>(
    'request_account_deletion',
    { p_account: input.accountId, p_user: input.userId, p_hostname: input.hostname },
  );
  if (!r.ok) return refusal(r.code);
  await ports.sendEmails([accountEmail(input.accountId, 'account_delete', r.confirmTokenId)]);
  await ports.capture('account_deletion_requested', input.accountId, { tier: r.tier });
  return { ok: true };
}

/** The confirmation link's POST. `token` is the raw token from the flow's cookie. */
export async function confirmDeletion(
  ports: DeletionPorts,
  token: string,
): Promise<DeletionAnswer> {
  const r = await ports.rpc<
    Refused | { ok: true; userId: string; accountId: string; tier: Tier; accounts: string[] }
  >('confirm_account_deletion', { p_hash: hashToken(token), p_now: ports.now().toISOString() });
  if (!r.ok) return refusal(r.code);

  await banAfterConfirm(ports, r.userId);
  // Tried BAN_ATTEMPTS times, then reported: the deletion stands either way, and the purge cancels any
  // subscription still live before it erases.
  await withRetries(ports, r.userId, () =>
    ports.send(
      r.accounts.map((accountId) => ({
        name: 'account.deletion_confirmed' as const,
        data: { userId: r.userId, accountId },
      })),
    ),
  );
  await ports.capture('account_deletion_confirmed', r.accountId, {
    tier: r.tier,
    accounts: r.accounts.length,
  });
  return { ok: true };
}

/**
 * The confirm's ban, in line with the database: banned while the person has a pending_erasures row.
 * The confirm has committed, so a read that fails counts as "pending" (reported, user id only): the
 * person is banned, never left signed in. After the ban the row is read again, so a restore that
 * committed while the ban was on its way still ends unbanned.
 */
async function banAfterConfirm(ports: DeletionPorts, userId: string): Promise<void> {
  const pending = async () => {
    try {
      return await ports.rpc<boolean>('erasure_pending', { p_user: userId });
    } catch (error) {
      ports.report(error, userId);
      return true;
    }
  };
  if (!(await pending())) return unbanAfterRestore(ports, userId);
  if (!(await withRetries(ports, userId, () => ports.auth.ban(userId)))) return;
  if (!(await pending())) await unbanAfterRestore(ports, userId);
}

/**
 * A committed restore lifts the ban with no read first: the restore cleared the person's
 * pending_erasures row. A confirm whose ban lands after this unban reads the row again after banning
 * and lifts the ban when the row is gone; if that read fails it counts as pending, so that ban stays
 * (reported, user id only).
 */
async function unbanAfterRestore(ports: DeletionPorts, userId: string): Promise<void> {
  await withRetries(ports, userId, () => ports.auth.unban(userId));
}

async function withRetries(
  ports: DeletionPorts,
  userId: string,
  call: () => Promise<void>,
): Promise<boolean> {
  for (let attempt = 1; ; attempt++) {
    try {
      await call();
      return true;
    } catch (error) {
      if (attempt >= BAN_ATTEMPTS) {
        ports.report(error, userId);
        return false;
      }
    }
  }
}

/** The restore link's POST. */
export async function restoreAccount(ports: DeletionPorts, token: string): Promise<DeletionAnswer> {
  const hash = hashToken(token);
  const now = ports.now().toISOString();
  const link = await ports.rpc<Refused | { ok: true; userId: string }>('read_deletion_link', {
    p_kind: 'delete_restore',
    p_hash: hash,
    p_now: now,
  });
  if (!link.ok) return refusal(link.code);

  let r: Refused | { ok: true; accountId: string; tier: Tier; resume: string[] };
  try {
    r = await ports.rpc('restore_account', { p_hash: hash, p_now: now });
  } catch (error) {
    // The answer may be lost after the restore committed: the database says which. Nothing can be
    // sent for the plans the restore would resume (their names went with the answer), so it is
    // reported, user id only, for the subscriptions to be resumed by hand.
    let state: 'pending' | 'restored' | 'erased' | null = null;
    // Tried BAN_ATTEMPTS times; on the last failure reported (user id only), and the restore's own
    // error is thrown, as when the restore did not commit: the page says it did not work.
    await withRetries(ports, link.userId, async () => {
      state = await ports.rpc('erasure_state', { p_user: link.userId });
    });
    if (state === null || state === 'pending') throw error;
    ports.report(error, link.userId);
    // The purge finished in between: the account is not back.
    if (state === 'erased') return refusal('window_closed');
    await unbanAfterRestore(ports, link.userId);
    return { ok: true };
  }
  if (!r.ok) return refusal(r.code);
  await unbanAfterRestore(ports, link.userId);
  if (r.resume.length > 0) {
    try {
      await ports.send([
        { name: 'account.restored', data: { userId: link.userId, subscriptionIds: r.resume } },
      ]);
    } catch (error) {
      // The account is back; the plan stays set to end, which the person can undo in the portal.
      ports.report(error, link.userId);
    }
  }
  await ports.capture('account_restored', r.accountId, { tier: r.tier });
  return { ok: true };
}
