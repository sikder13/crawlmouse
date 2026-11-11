/**
 * The owner's email change (D3), over its ports: the route wires them (`email-change-ports.ts`), the
 * tests pass recorders and the PostgREST stand-in. The SQL it calls is migration 027b's section A,
 * whose header lists the refusals mapped below.
 *
 * - Request: the new address gets a sixty-minute confirmation link. The answer does not depend on
 *   whether the address is in use, so the form cannot be used to find out who has an account; the
 *   confirm is where a taken address shows.
 * - Confirm: our rows move first (`apply_email_change`), then Supabase Auth's, with the address
 *   marked confirmed, since the confirmation link proved it. If Auth refuses, our rows go back.
 *   Then every session of the person ends except the confirming browser's own, when that browser
 *   is signed in as the person; the old address is told, with a seven-day undo link.
 * - Undo: Auth goes back to the old address before our rows do (`undo_email_change` consumes the
 *   link last), so a failure on the way leaves the link usable and the page can be posted again.
 *   Every session ends.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Tier } from '../../entitlement-v2';
import type { CaptureAccountEvent } from './account-events';
import { accountEmail, type SendEmails } from './emails';
import { hashToken, isToken, newToken } from './tokens';

export interface RpcError {
  code: string;
  message: string;
}

/** A service-role `rpc`, as supabase-js answers it. */
export type Rpc = (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: RpcError | null }>;

export interface EmailChangePorts {
  rpc: Rpc;
  auth: {
    /** Sets the Auth user's address, marked confirmed; says when Auth holds it for another user. */
    updateEmail(userId: string, email: string): Promise<'ok' | 'address_taken'>;
    deleteUser(userId: string): Promise<void>;
  };
  sendEmails: SendEmails;
  capture: CaptureAccountEvent;
  /** Counts one request against a daily bucket: false when the bucket is spent or cannot be counted. */
  rateLimit(bucket: string, limit: number): Promise<boolean>;
  /** An error-tracker signal; `extra` carries ids only, never an address. */
  report(signal: string, extra: Readonly<Record<string, string>>): void;
  now(): Date;
}

export type EmailChangeOutcome = { ok: true } | { ok: false; status: number; code: string };

export const EMAIL_CHANGE_LIMITS = { perUser: 3, perIp: 10 } as const;

const refused = (status: number, code: string): EmailChangeOutcome => ({ ok: false, status, code });

/** Section A's SQLSTATEs, as the routes answer them. */
const REFUSALS: Readonly<Record<string, EmailChangeOutcome>> = {
  CMA01: refused(400, 'same_address'),
  CMA02: refused(409, 'email_change_pending'),
  CMA03: refused(409, 'account_deleting'),
  CMA04: refused(409, 'address_taken'),
  CMA05: refused(410, 'link_unusable'),
};

const LINK_UNUSABLE = REFUSALS.CMA05!;
const ADDRESS_TAKEN = REFUSALS.CMA04!;
const AUTH_FAILED = refused(502, 'auth_failed');

type Called<T> = { ok: true; value: T } | { ok: false; outcome: EmailChangeOutcome };

/** Calls a section A function: its value parsed, or the answer for a refusal it raised. */
async function call<T>(
  ports: EmailChangePorts,
  fn: string,
  args: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<Called<T>> {
  const { data, error } = await ports.rpc(fn, args);
  if (error) {
    const outcome = REFUSALS[error.code];
    if (outcome) return { ok: false, outcome };
    throw new Error(`${fn}: ${error.code} ${error.message}`);
  }
  return { ok: true, value: schema.parse(data) };
}

async function endSessions(ports: EmailChangePorts, userId: string, keep: string | null) {
  const { error } = await ports.rpc('end_user_sessions', { p_user: userId, p_keep_session: keep });
  if (error) throw new Error(`end_user_sessions: ${error.code} ${error.message}`);
}

const NewEmail = z.string().trim().toLowerCase().max(254).pipe(z.email());

export interface EmailChangeRequest {
  accountId: string;
  userId: string;
  /** The person's address now, from their session. */
  currentEmail: string;
  /** As the form or JSON sent it; validated here. */
  newEmail: unknown;
  ip: string;
}

export async function requestEmailChange(
  ports: EmailChangePorts,
  input: EmailChangeRequest,
): Promise<EmailChangeOutcome> {
  const parsed = NewEmail.safeParse(input.newEmail);
  if (!parsed.success) return refused(400, 'invalid_email');
  const newEmail = parsed.data;
  if (newEmail === input.currentEmail.toLowerCase()) return REFUSALS.CMA01!;

  // Both buckets end in a value the erasure finds (the user id, or the address's hash), and both
  // refuse when they cannot be counted.
  const ipHash = createHash('sha256').update(input.ip, 'utf8').digest('hex');
  if (!(await ports.rateLimit(`account-email:user:${input.userId}`, EMAIL_CHANGE_LIMITS.perUser)))
    return refused(429, 'rate_limited');
  if (!(await ports.rateLimit(`account-email:ip:${ipHash}`, EMAIL_CHANGE_LIMITS.perIp)))
    return refused(429, 'rate_limited');

  const token = newToken();
  const issued = await call(
    ports,
    'request_email_change',
    {
      p_account: input.accountId,
      p_user: input.userId,
      p_new_email: newEmail,
      p_hash: hashToken(token),
      p_raw: token,
      p_now: ports.now().toISOString(),
    },
    z.string().uuid(),
  );
  if (!issued.ok) return issued.outcome;
  await ports.sendEmails([accountEmail(input.accountId, 'email_change_confirm', [issued.value])]);
  return { ok: true };
}

const Applied = z.object({
  user_id: z.string(),
  account_id: z.string(),
  new_email: z.string(),
  undo_token_id: z.string(),
  tier: z.enum(['free', 'pro', 'agency']) satisfies z.ZodType<Tier>,
});

export interface EmailChangeConfirm {
  /** From the link's cookie. */
  token: string;
  /** The confirming browser's session, when it has one. */
  caller: { userId: string; sessionId: string } | null;
}

export async function confirmEmailChange(
  ports: EmailChangePorts,
  input: EmailChangeConfirm,
): Promise<EmailChangeOutcome> {
  if (!isToken(input.token)) return LINK_UNUSABLE;
  const undo = newToken();
  const applied = await call(
    ports,
    'apply_email_change',
    {
      p_hash: hashToken(input.token),
      p_now: ports.now().toISOString(),
      p_undo_hash: hashToken(undo),
      p_undo_raw: undo,
    },
    Applied,
  );
  if (!applied.ok) return applied.outcome;
  const a = applied.value;

  let auth: 'ok' | 'address_taken' | 'failed';
  try {
    auth = await ports.auth.updateEmail(a.user_id, a.new_email);
  } catch {
    auth = 'failed';
  }
  if (auth !== 'ok') {
    const { error } = await ports.rpc('revert_email_change', { p_undo_token: a.undo_token_id });
    ports.report(`account.email_change.${auth === 'failed' ? 'auth_failed' : 'address_taken'}`, {
      userId: a.user_id,
    });
    if (error) throw new Error(`revert_email_change: ${error.code} ${error.message}`);
    return auth === 'failed' ? AUTH_FAILED : ADDRESS_TAKEN;
  }

  const keep = input.caller?.userId === a.user_id ? input.caller.sessionId : null;
  await endSessions(ports, a.user_id, keep);
  await ports.capture('account_email_changed', a.account_id, { tier: a.tier });
  await ports.sendEmails([accountEmail(a.account_id, 'email_change_notice', [a.undo_token_id])]);
  return { ok: true };
}

const Prepared = z.object({
  user_id: z.string(),
  old_email: z.string(),
  squatter: z.string().nullable(),
});

export async function undoEmailChange(
  ports: EmailChangePorts,
  input: { token: string },
): Promise<EmailChangeOutcome> {
  if (!isToken(input.token)) return LINK_UNUSABLE;
  const hash = hashToken(input.token);
  const prepared = await call(
    ports,
    'prepare_email_undo',
    { p_hash: hash, p_now: ports.now().toISOString() },
    Prepared,
  );
  if (!prepared.ok) {
    if (prepared.outcome === ADDRESS_TAKEN) ports.report('account.email_undo.address_taken', {});
    return prepared.outcome;
  }
  const p = prepared.value;

  if (p.squatter !== null) {
    // prepare_email_undo returns a holder only when it was created after the change and holds
    // nothing; its accounts are gone, and deleting it from Auth deletes its profile.
    await ports.auth.deleteUser(p.squatter);
    ports.report('account.email_undo.squatter_removed', {
      userId: p.user_id,
      squatter: p.squatter,
    });
  }

  let auth: 'ok' | 'address_taken' | 'failed';
  try {
    auth = await ports.auth.updateEmail(p.user_id, p.old_email);
  } catch {
    auth = 'failed';
  }
  if (auth !== 'ok') {
    ports.report(
      auth === 'failed' ? 'account.email_undo.auth_failed' : 'account.email_undo.address_taken',
      { userId: p.user_id },
    );
    return auth === 'failed' ? AUTH_FAILED : ADDRESS_TAKEN;
  }

  const undone = await call(
    ports,
    'undo_email_change',
    { p_hash: hash, p_now: ports.now().toISOString() },
    z.object({ user_id: z.string() }),
  );
  if (!undone.ok) return undone.outcome;
  await endSessions(ports, undone.value.user_id, null);
  return { ok: true };
}
