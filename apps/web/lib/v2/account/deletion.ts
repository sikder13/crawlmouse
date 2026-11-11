/**
 * Deleting an account (D4): the request, the confirmation link's POST and the restore link's POST,
 * over ports. The rules and every write are the SQL of migration 20261112000002 section B
 * (`request_account_deletion`, `confirm_account_deletion`, `read_deletion_link`, `restore_account`);
 * this module adds what SQL cannot do: the Auth ban, the emails, the events, and the Inngest event that
 * ends the subscription.
 *
 * Confirm, in this order (plan-revision R4): the SQL confirm (marks the accounts, queues the person,
 * ends their sessions); then the Auth ban, tried three times, and on failure reported with the user id
 * only while the answer is still "done", because the purge bans again before it erases; then one
 * `account.deletion_confirmed` per marked account. Restore: the link is read (valid, unused, inside its
 * window), the ban lifted, and then the SQL restore consumes the token; when the SQL step does not
 * restore, the person is banned again and the token is still unused, so the page can be posted again.
 * A subscription the deletion set to end is resumed by `account.restored` (deletionResumeFn).
 */
import type { Tier } from '../../entitlement-v2';
import type { CaptureAccountEvent } from './account-events';
import { accountEmail, type SendEmails } from './emails';
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
  // Bucket keys end with `:<user id>`, so the erasure's rate-limit rule removes them with the person.
  const allowed =
    (await ports.rateLimit(`account:delete:user:${input.userId}`, DELETE_REQUESTS_PER_USER)) &&
    (input.ip === null ||
      (await ports.rateLimit(`account:delete:ip:${input.ip}`, DELETE_REQUESTS_PER_IP)));
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

  await banWithRetries(ports, r.userId);
  try {
    await ports.send(
      r.accounts.map((accountId) => ({
        name: 'account.deletion_confirmed' as const,
        data: { userId: r.userId, accountId },
      })),
    );
  } catch (error) {
    // The deletion stands; the purge cancels any subscription still live before it erases.
    ports.report(error, r.userId);
  }
  await ports.capture('account_deletion_confirmed', r.accountId, {
    tier: r.tier,
    accounts: r.accounts.length,
  });
  return { ok: true };
}

async function banWithRetries(ports: DeletionPorts, userId: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await ports.auth.ban(userId);
      return;
    } catch (error) {
      if (attempt >= BAN_ATTEMPTS) {
        ports.report(error, userId);
        return;
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

  await ports.auth.unban(link.userId);
  let r: Refused | { ok: true; accountId: string; tier: Tier; resume: string[] };
  try {
    r = await ports.rpc('restore_account', { p_hash: hash, p_now: now });
  } catch (error) {
    await ports.auth.ban(link.userId);
    throw error;
  }
  if (!r.ok) {
    await ports.auth.ban(link.userId);
    return refusal(r.code);
  }
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
