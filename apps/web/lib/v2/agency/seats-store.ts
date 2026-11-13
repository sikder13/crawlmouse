/**
 * The seat routes' writes and the invitation page's read (CC-31 D3), over migration
 * 20261114000002's section A with the service-role client. A route makes this store only after the
 * caller's own session has answered `seat_may` for the account (or, for an acceptance, after it has
 * the caller's session: the invitation's token is then the credential).
 *
 * A link's token is hashed here (`hashToken`); the SQL functions take and compare the hash.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { inngest } from '../../../../../inngest/client';
import { hashToken } from '../account/tokens';
import { inviteMailEvent, type InvitedRole, type InviteMail, type InviteMailEvent } from './seats';

const Role = z.enum(['account_manager', 'developer']);

const InviteAnswer = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('invited'), seat_id: z.uuid(), seq: z.int().min(1) }),
  z.strictObject({ outcome: z.enum(['marked', 'invalid_scope', 'exists', 'full']) }),
]);

const ResendAnswer = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('resent'), seq: z.int().min(1) }),
  z.strictObject({ outcome: z.enum(['marked', 'not_found', 'not_invited']) }),
]);

const ChangeAnswer = z.strictObject({
  outcome: z.enum(['changed', 'marked', 'not_found', 'owner', 'invalid_scope']),
});

const RemoveAnswer = z.strictObject({
  outcome: z.enum(['removed', 'marked', 'not_found', 'owner']),
});

const ReadAnswer = z.discriminatedUnion('outcome', [
  z.strictObject({
    outcome: z.literal('invite'),
    account_name: z.string().nullable(),
    role: Role,
    scope_all: z.boolean(),
  }),
  z.strictObject({ outcome: z.literal('gone') }),
]);

const AcceptAnswer = z.discriminatedUnion('outcome', [
  z.strictObject({
    outcome: z.literal('accepted'),
    account_id: z.uuid(),
    seat_id: z.uuid(),
    role: Role,
  }),
  z.strictObject({
    outcome: z.enum(['gone', 'email_mismatch', 'marked', 'already_member', 'full']),
  }),
]);

export type InviteOutcome =
  | { outcome: 'invited'; seatId: string; seq: number }
  | { outcome: 'marked' | 'invalid_scope' | 'exists' | 'full' };

export type ResendOutcome =
  | { outcome: 'resent'; seq: number }
  | { outcome: 'marked' | 'not_found' | 'not_invited' };

export type ChangeOutcome = z.infer<typeof ChangeAnswer>;
export type RemoveOutcome = z.infer<typeof RemoveAnswer>;

/** What an invitation's page says: never the invited address. */
export interface InviteView {
  accountName: string | null;
  role: InvitedRole;
  /** False when the seat covers some clients only. */
  everyClient: boolean;
}

export type AcceptOutcome =
  | { outcome: 'accepted'; accountId: string; seatId: string; role: InvitedRole }
  | { outcome: 'gone' | 'email_mismatch' | 'marked' | 'already_member' | 'full' };

export interface SeatsStore {
  /** `siteIds` null is every client; `cap` is the account's seat limit as the viewer read it. */
  invite(req: {
    accountId: string;
    email: string;
    role: InvitedRole;
    siteIds: string[] | null;
    cap: number;
    now: Date;
  }): Promise<InviteOutcome>;
  resend(seatId: string, accountId: string): Promise<ResendOutcome>;
  change(
    seatId: string,
    accountId: string,
    role: InvitedRole,
    siteIds: string[] | null,
  ): Promise<ChangeOutcome>;
  remove(seatId: string, accountId: string, now: Date): Promise<RemoveOutcome>;
  /** The invitation a link's token opens, or null when the link cannot be used. */
  readInvite(token: string, now: Date): Promise<InviteView | null>;
  accept(token: string, userId: string, now: Date): Promise<AcceptOutcome>;
}

async function call<T>(admin: SupabaseClient, fn: string, args: object, schema: z.ZodType<T>) {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return schema.parse(data);
}

export function supabaseSeatsStore(admin: SupabaseClient): SeatsStore {
  return {
    async invite(req) {
      const a = await call(
        admin,
        'invite_seat',
        {
          p_account: req.accountId,
          p_email: req.email,
          p_role: req.role,
          p_site_ids: req.siteIds,
          p_cap: req.cap,
          p_now: req.now.toISOString(),
        },
        InviteAnswer,
      );
      return a.outcome === 'invited' ? { outcome: 'invited', seatId: a.seat_id, seq: a.seq } : a;
    },
    resend: (seatId, accountId) =>
      call(admin, 'resend_seat_invite', { p_seat: seatId, p_account: accountId }, ResendAnswer),
    change: (seatId, accountId, role, siteIds) =>
      call(
        admin,
        'change_seat',
        { p_seat: seatId, p_account: accountId, p_role: role, p_site_ids: siteIds },
        ChangeAnswer,
      ),
    remove: (seatId, accountId, now) =>
      call(
        admin,
        'remove_seat',
        { p_seat: seatId, p_account: accountId, p_now: now.toISOString() },
        RemoveAnswer,
      ),
    async readInvite(token, now) {
      const a = await call(
        admin,
        'read_seat_invite',
        { p_token_hash: hashToken(token), p_now: now.toISOString() },
        ReadAnswer,
      );
      return a.outcome === 'gone'
        ? null
        : { accountName: a.account_name, role: a.role, everyClient: a.scope_all };
    },
    async accept(token, userId, now) {
      const a = await call(
        admin,
        'accept_seat_invite',
        { p_token_hash: hashToken(token), p_user: userId, p_now: now.toISOString() },
        AcceptAnswer,
      );
      return a.outcome === 'accepted'
        ? { outcome: 'accepted', accountId: a.account_id, seatId: a.seat_id, role: a.role }
        : a;
    },
  };
}

/**
 * The invitation mail's request, sent as the `seat.invite.requested` event (`inviteMailEvent`). The
 * function that handles it mints the link (`issue_seat_invite`) and sends the mail.
 */
export function inngestInviteMail(
  send: (event: InviteMailEvent) => Promise<unknown> = (event) => inngest.send(event),
): InviteMail {
  return {
    async request(invitation) {
      await send(inviteMailEvent(invitation));
    },
  };
}
