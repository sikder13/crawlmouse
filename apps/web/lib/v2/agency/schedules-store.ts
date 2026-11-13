/**
 * Client report schedules over the database (CC-31 D8), with the service-role client, and the mail
 * port's requests as Inngest events. A route makes the store only after the caller's own session
 * has answered `is_member_for_site` and `seat_may`; for the recipient's two links the token is the
 * credential. A link's token is hashed here (`hashToken`); the SQL functions take the hash.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { inngest } from '../../../../../inngest/client';
import { hashToken } from '../account/tokens';
import {
  confirmationRequestedEvent,
  reportSendRequestedEvent,
  type ClientInput,
  type ClientReportMail,
  type ClientSite,
  type ConfirmationRequestedEvent,
  type ReportSendRequestedEvent,
  type ScheduleInput,
} from './schedules';
import type { ScheduleRunStore } from './schedules-run';

const Saved = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('saved'), next_run_at: z.string() }),
  z.strictObject({ outcome: z.literal('not_found') }),
]);
const ClientSaved = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('saved'), contact_changed: z.boolean() }),
  z.strictObject({ outcome: z.enum(['not_found', 'invalid_owner']) }),
]);
const Cleared = z.strictObject({ outcome: z.enum(['cleared', 'not_found']) });
const Resumed = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('resumed'), next_run_at: z.string() }),
  z.strictObject({ outcome: z.enum(['not_paused', 'not_found']) }),
]);
const LinkRead = z.discriminatedUnion('outcome', [
  z.strictObject({
    outcome: z.enum(['confirm', 'pause']),
    host: z.string(),
    account_name: z.string().nullable(),
  }),
  z.strictObject({ outcome: z.literal('gone') }),
]);
const LinkUsed = z.strictObject({ outcome: z.enum(['confirmed', 'paused', 'gone']) });

/** What a recipient's link page says: the kind of link, the site and who sends the reports. */
export interface RecipientLinkView {
  kind: 'confirm' | 'pause';
  host: string;
  accountName: string | null;
}

export type ConfirmationState =
  | 'pending'
  | 'asked'
  | 'trial'
  | 'paused'
  | 'confirmed'
  | 'no_contact'
  | 'no_schedule';

export interface SchedulesStore {
  setSchedule(
    site: ClientSite,
    input: ScheduleInput,
    now: Date,
  ): Promise<{ outcome: 'saved'; nextRunAt: string } | { outcome: 'not_found' | 'invalid' }>;
  clearSchedule(site: ClientSite): Promise<{ outcome: 'cleared' | 'not_found' }>;
  setClient(
    site: ClientSite,
    input: ClientInput,
  ): Promise<
    { outcome: 'saved'; contactChanged: boolean } | { outcome: 'not_found' | 'invalid_owner' }
  >;
  /**
   * Where the site's schedule stands with its contact. `pending`: not confirmed, and no link sent
   * yet; `asked`: a link was sent and not used; `trial`: not confirmed, and the account is in its
   * Agency trial with a contact that is not its owner's own address, so no confirmation is mailed
   * (`issue_recipient_confirmation` holds the same rule); else why there is nothing to ask.
   */
  confirmationState(site: ClientSite): Promise<ConfirmationState>;
  resume(
    site: ClientSite,
    now: Date,
  ): Promise<{ outcome: 'resumed'; nextRunAt: string } | { outcome: 'not_paused' | 'not_found' }>;
  /** The link a token opens, or null when it cannot be used. It changes nothing. */
  readLink(token: string, now: Date): Promise<RecipientLinkView | null>;
  confirm(token: string, now: Date): Promise<'confirmed' | 'gone'>;
  pause(token: string, now: Date): Promise<'paused' | 'gone'>;
}

interface RpcError {
  code?: string;
  message: string;
}

async function call<T>(admin: SupabaseClient, fn: string, args: object, schema: z.ZodType<T>) {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw Object.assign(new Error(`${fn} failed: ${error.message}`), { code: error.code });
  return schema.parse(data);
}

const instant = (v: string) => new Date(v).toISOString();

export function supabaseSchedulesStore(admin: SupabaseClient): SchedulesStore {
  return {
    async setSchedule(site, input, now) {
      try {
        const a = await call(
          admin,
          'set_report_schedule',
          {
            p_site: site.siteId,
            p_account: site.accountId,
            p: {
              cadence: input.cadence,
              iso_weekday: input.isoWeekday,
              time_local: input.timeLocal,
              timezone: input.timezone,
              send_when_unchanged: input.sendWhenUnchanged,
            },
            p_now: now.toISOString(),
          },
          Saved,
        );
        return a.outcome === 'saved' ? { outcome: 'saved', nextRunAt: instant(a.next_run_at) } : a;
      } catch (e) {
        // 22023: a zone this runtime knows and PostgreSQL does not.
        if ((e as RpcError).code === '22023') return { outcome: 'invalid' };
        throw e;
      }
    },
    clearSchedule: (site) =>
      call(
        admin,
        'clear_report_schedule',
        { p_site: site.siteId, p_account: site.accountId },
        Cleared,
      ),
    async setClient(site, input) {
      const p = {
        ...(input.clientName === undefined ? {} : { client_name: input.clientName }),
        ...(input.contactEmail === undefined ? {} : { client_contact_email: input.contactEmail }),
        ...(input.ownerSeatId === undefined ? {} : { owner_seat_id: input.ownerSeatId }),
      };
      const a = await call(
        admin,
        'set_client',
        { p_site: site.siteId, p_account: site.accountId, p },
        ClientSaved,
      );
      return a.outcome === 'saved' ? { outcome: 'saved', contactChanged: a.contact_changed } : a;
    },
    async confirmationState(site) {
      const schedule = await admin
        .from('report_schedules')
        .select('recipient_confirmed_at, recipient_confirm_sent_at, paused_by_recipient_at')
        .eq('site_id', site.siteId)
        .eq('account_id', site.accountId)
        .maybeSingle();
      if (schedule.error)
        throw new Error(`report_schedules read failed: ${schedule.error.message}`);
      if (schedule.data === null) return 'no_schedule';
      const contact = await admin
        .from('sites')
        .select('client_contact_email')
        .eq('id', site.siteId)
        .maybeSingle();
      if (contact.error) throw new Error(`sites read failed: ${contact.error.message}`);
      const address = (contact.data as { client_contact_email: string | null } | null)
        ?.client_contact_email;
      if (!address) return 'no_contact';
      const held = schedule.data as {
        recipient_confirmed_at: string | null;
        recipient_confirm_sent_at: string | null;
        paused_by_recipient_at: string | null;
      };
      // A recipient's pause is final from the sender's side: resume is the one way to ask.
      if (held.paused_by_recipient_at) return 'paused';
      if (held.recipient_confirmed_at) return 'confirmed';

      // In its Agency trial an account mails its owner's own address and no other.
      const account = await admin
        .from('accounts')
        .select('state')
        .eq('id', site.accountId)
        .maybeSingle();
      if (account.error) throw new Error(`accounts read failed: ${account.error.message}`);
      if ((account.data as { state: string } | null)?.state === 'agency_trial') {
        const owner = await admin
          .from('seats')
          .select('user_id')
          .eq('account_id', site.accountId)
          .eq('role', 'owner')
          .eq('status', 'active')
          .maybeSingle();
        if (owner.error) throw new Error(`seats read failed: ${owner.error.message}`);
        const ownerId = (owner.data as { user_id: string | null } | null)?.user_id ?? null;
        const user =
          ownerId === null
            ? { data: null, error: null }
            : await admin.from('users').select('email').eq('id', ownerId).maybeSingle();
        if (user.error) throw new Error(`users read failed: ${user.error.message}`);
        const own = (user.data as { email: string | null } | null)?.email ?? null;
        if (own === null || own.toLowerCase() !== address.toLowerCase()) return 'trial';
      }
      return held.recipient_confirm_sent_at ? 'asked' : 'pending';
    },
    async resume(site, now) {
      const a = await call(
        admin,
        'resume_report_schedule',
        { p_site: site.siteId, p_account: site.accountId, p_now: now.toISOString() },
        Resumed,
      );
      return a.outcome === 'resumed'
        ? { outcome: 'resumed', nextRunAt: instant(a.next_run_at) }
        : a;
    },
    async readLink(token, now) {
      const a = await call(
        admin,
        'read_report_link',
        { p_token_hash: hashToken(token), p_now: now.toISOString() },
        LinkRead,
      );
      return a.outcome === 'gone'
        ? null
        : { kind: a.outcome, host: a.host, accountName: a.account_name };
    },
    async confirm(token, now) {
      const a = await call(
        admin,
        'confirm_report_recipient',
        { p_token_hash: hashToken(token), p_now: now.toISOString() },
        LinkUsed,
      );
      return a.outcome === 'confirmed' ? 'confirmed' : 'gone';
    },
    async pause(token, now) {
      const a = await call(
        admin,
        'pause_report_schedule',
        { p_token_hash: hashToken(token), p_now: now.toISOString() },
        LinkUsed,
      );
      return a.outcome === 'paused' ? 'paused' : 'gone';
    },
  };
}

/**
 * The two mails' requests, sent as Inngest events that name a site or a report and nothing else.
 * The functions that handle them read the address and mint the link in SQL, and send the mail. A
 * report handed on this way is `queued`: its row becomes `sent` when its mail has gone
 * (`mark_client_report_sent`).
 */
export function inngestClientReportMail(
  send: (event: ConfirmationRequestedEvent | ReportSendRequestedEvent) => Promise<unknown> = (
    event,
  ) => inngest.send(event),
): ClientReportMail {
  return {
    async confirmation({ siteId, key }) {
      await send(confirmationRequestedEvent(siteId, key));
    },
    async report({ reportId }) {
      await send(reportSendRequestedEvent(reportId));
      return 'queued';
    },
  };
}

// ─── the hourly run ──────────────────────────────────────────────────────────────────────────────

const Instant = z.string().nullable();
const DueRow = z.strictObject({
  site_id: z.uuid(),
  account_id: z.uuid(),
  slot: z.string(),
  send_when_unchanged: z.boolean(),
  has_contact: z.boolean(),
  confirmed: z.boolean(),
  confirmation_requested: z.boolean(),
  contact_is_owner: z.boolean(),
  state: z.enum(['free', 'pro_trial', 'pro', 'agency_trial', 'agency', 'past_due']),
  tier: z.enum(['free', 'pro', 'agency']),
  past_due_tier: z.enum(['pro', 'agency']).nullable(),
  past_due_since: Instant,
  trial_variant: z.enum(['no_card', 'card_required']).nullable(),
  trial_ends_at: Instant,
  check_id: z.uuid().nullable(),
  changed: z.boolean(),
});
const Written = z.discriminatedUnion('outcome', [
  z.strictObject({
    outcome: z.enum(['written', 'exists']),
    report_id: z.uuid(),
    status: z.string(),
  }),
  z.strictObject({ outcome: z.literal('none') }),
]);
const Sent = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('sent'), account_id: z.uuid(), first: z.boolean() }),
  z.strictObject({ outcome: z.enum(['already', 'not_found']) }),
]);

const dateOrNull = (v: string | null) => (v === null ? null : new Date(v));

/** The hourly run's reads and writes (`schedules-run.ts`), over section B's functions. */
export function supabaseScheduleRunStore(admin: SupabaseClient): ScheduleRunStore {
  return {
    async due(now, limit) {
      const rows = await call(
        admin,
        'due_report_schedules',
        { p_now: now.toISOString(), p_limit: limit },
        z.array(DueRow),
      );
      return rows.map((r) => ({
        siteId: r.site_id,
        accountId: r.account_id,
        slot: instant(r.slot),
        sendWhenUnchanged: r.send_when_unchanged,
        hasContact: r.has_contact,
        confirmed: r.confirmed,
        confirmationRequested: r.confirmation_requested,
        contactIsOwner: r.contact_is_owner,
        account: {
          state: r.state,
          tier: r.tier,
          pastDueTier: r.past_due_tier,
          pastDueSince: dateOrNull(r.past_due_since),
          trialVariant: r.trial_variant,
          trialEndsAt: dateOrNull(r.trial_ends_at),
        },
        checkId: r.check_id,
        changed: r.changed,
      }));
    },
    async writeReport(siteId, slot, checkId, now) {
      const a = await call(
        admin,
        'write_client_report',
        { p_site: siteId, p_slot: slot, p_check: checkId, p_now: now.toISOString() },
        Written,
      );
      if (a.outcome === 'none') return null;
      return { reportId: a.report_id, status: a.status === 'sent' ? 'sent' : 'scheduled' };
    },
    async markSent(reportId, now) {
      const a = await call(
        admin,
        'mark_client_report_sent',
        { p_report: reportId, p_now: now.toISOString() },
        Sent,
      );
      return a.outcome === 'sent' ? { accountId: a.account_id, first: a.first } : null;
    },
    async markRun(siteId, now) {
      const { error } = await admin.rpc('mark_report_schedule_run', {
        p_site: siteId,
        p_now: now.toISOString(),
      });
      if (error) throw new Error(`mark_report_schedule_run failed: ${error.message}`);
    },
  };
}
