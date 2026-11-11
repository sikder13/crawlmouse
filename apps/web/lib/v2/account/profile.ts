/**
 * The account's profile and email preferences (CC-27b D6): the write behind `PATCH /api/account`.
 * The route establishes the caller's seat role through their own session (`member_role`) and hands
 * it here with the body; this module decides what may be saved and writes it to that one account.
 *
 * What it saves: `name`, `timezone` and `email_prefs` (`accounts.email_change_notes`,
 * `accounts.email_trial_reminder`), for the owner or an account manager. A developer is refused
 * (403). A changed `newEmail` is never saved here: for the owner it is handed back as
 * `forwardEmailChange` for the email-change confirmation (`/api/account/email`) to start, and a
 * manager's is refused (403) with nothing of the request saved.
 *
 * Bodies come in two shapes. JSON carries the contract's `{ name, timezone, email_prefs, newEmail }`.
 * A form carries what Settings posts: the account form's `newEmail` and `name`, or one switch's
 * `change_notes` or `trial_reminder` as "true" or "false". A field outside the shape refuses the
 * whole body.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { RequestBody } from '../../billing/request-body';

export type SeatRole = 'owner' | 'account_manager' | 'developer';

export const NAME_MAX = 80;

/**
 * The zone names accepted: those this runtime's ICU lists, and `UTC` (the column's default, which the
 * list leaves out). What that leaves out is the zones ICU calls aliases: on Node 22 the list holds
 * `Europe/Kiev` and `Asia/Calcutta` but not `Europe/Kyiv`, `Asia/Kolkata`, `Etc/UTC` or `US/Eastern`,
 * which Postgres also knows. profile.test.ts checks each listed name against `pg_timezone_names`.
 */
export const ZONES: ReadonlySet<string> = new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']);

export interface ProfilePatch {
  name?: string | null;
  timezone?: string;
  email_prefs?: { change_notes?: boolean; trial_reminder?: boolean };
}

export interface ProfilePorts {
  /** Writes the patch's columns to the account `accountId`, and to no other row. */
  updateAccount(accountId: string, columns: Readonly<Record<string, unknown>>): Promise<void>;
}

export type ProfileOutcome =
  | { ok: true; saved: ProfilePatch; forwardEmailChange: string | null }
  | { ok: false; status: 403; code: 'role_refused' | 'email_change_owner_only' }
  | { ok: false; status: 400; code: 'invalid'; field?: string };

const name = z
  .string()
  .transform((v) => v.trim())
  .pipe(z.string().max(NAME_MAX))
  .transform((v) => (v === '' ? null : v));
const timezone = z.string().refine((v) => ZONES.has(v));
const email = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.email().max(254));
const formSwitch = z.enum(['true', 'false']).transform((v) => v === 'true');

const JsonBody = z.strictObject({
  name: name.optional(),
  timezone: timezone.optional(),
  newEmail: email.optional(),
  email_prefs: z
    .strictObject({ change_notes: z.boolean().optional(), trial_reminder: z.boolean().optional() })
    .optional(),
});

const FormBody = z.strictObject({
  name: name.optional(),
  timezone: timezone.optional(),
  newEmail: email.optional(),
  change_notes: formSwitch.optional(),
  trial_reminder: formSwitch.optional(),
});

type Parsed =
  | { ok: true; patch: ProfilePatch; newEmail: string | null }
  | { ok: false; field?: string };

/**
 * The body as a patch and the changed address, if any: `newEmail` equal to `accountEmail` (trimmed,
 * case aside) is no change. A body with nothing to save and no changed address is refused.
 */
export function parseProfile(body: RequestBody, accountEmail: string): Parsed {
  const result =
    body.kind === 'json' ? JsonBody.safeParse(body.fields) : FormBody.safeParse(body.fields);
  if (!result.success) {
    const field = result.error.issues[0]?.path[0];
    return typeof field === 'string' ? { ok: false, field } : { ok: false };
  }
  const v = result.data;
  const prefs =
    'email_prefs' in v
      ? v.email_prefs
      : 'change_notes' in v || 'trial_reminder' in v
        ? {
            ...(v.change_notes === undefined ? {} : { change_notes: v.change_notes }),
            ...(v.trial_reminder === undefined ? {} : { trial_reminder: v.trial_reminder }),
          }
        : undefined;
  const patch: ProfilePatch = {
    ...(v.name === undefined ? {} : { name: v.name }),
    ...(v.timezone === undefined ? {} : { timezone: v.timezone }),
    ...(prefs === undefined || Object.keys(prefs).length === 0 ? {} : { email_prefs: prefs }),
  };
  const newEmail =
    v.newEmail === undefined || v.newEmail === accountEmail.trim().toLowerCase()
      ? null
      : v.newEmail;
  if (Object.keys(patch).length === 0 && newEmail === null) return { ok: false };
  return { ok: true, patch, newEmail };
}

function columnsOf(patch: ProfilePatch): Record<string, unknown> {
  return {
    ...(patch.name === undefined ? {} : { name: patch.name }),
    ...(patch.timezone === undefined ? {} : { timezone: patch.timezone }),
    ...(patch.email_prefs?.change_notes === undefined
      ? {}
      : { email_change_notes: patch.email_prefs.change_notes }),
    ...(patch.email_prefs?.trial_reminder === undefined
      ? {}
      : { email_trial_reminder: patch.email_prefs.trial_reminder }),
  };
}

/**
 * Saves the profile fields of `body` on `accountId` for a caller seated there as `role`, after the
 * route has read that role through the caller's own session. `accountEmail` is the account's
 * address (its owner's `users.email`), which the Settings form posts back as `newEmail` unchanged.
 */
export async function updateProfile(
  ports: ProfilePorts,
  input: { accountId: string; accountEmail: string; role: SeatRole; body: RequestBody },
): Promise<ProfileOutcome> {
  if (input.role !== 'owner' && input.role !== 'account_manager') {
    return { ok: false, status: 403, code: 'role_refused' };
  }
  const parsed = parseProfile(input.body, input.accountEmail);
  if (!parsed.ok) {
    return parsed.field === undefined
      ? { ok: false, status: 400, code: 'invalid' }
      : { ok: false, status: 400, code: 'invalid', field: parsed.field };
  }
  if (parsed.newEmail !== null && input.role !== 'owner') {
    return { ok: false, status: 403, code: 'email_change_owner_only' };
  }
  const columns = columnsOf(parsed.patch);
  if (Object.keys(columns).length > 0) await ports.updateAccount(input.accountId, columns);
  return { ok: true, saved: parsed.patch, forwardEmailChange: parsed.newEmail };
}

/** The write over the service role, keyed by the account id alone. */
export function supabaseProfilePorts(admin: SupabaseClient): ProfilePorts {
  return {
    async updateAccount(accountId, columns) {
      const { error } = await admin
        .from('accounts')
        .update({ ...columns, updated_at: new Date().toISOString() })
        .eq('id', accountId);
      if (error) throw new Error(`profile: accounts update failed: ${error.message}`);
    },
  };
}
