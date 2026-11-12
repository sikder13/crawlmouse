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
  /** Whether the site's schedule waits on its contact: `pending`, else why there is nothing to ask. */
  confirmationState(
    site: ClientSite,
  ): Promise<'pending' | 'confirmed' | 'no_contact' | 'no_schedule'>;
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
        .select('recipient_confirmed_at')
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
      if (!(contact.data as { client_contact_email: string | null } | null)?.client_contact_email) {
        return 'no_contact';
      }
      return (schedule.data as { recipient_confirmed_at: string | null }).recipient_confirmed_at
        ? 'confirmed'
        : 'pending';
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
