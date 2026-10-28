/** Site: a host an account watches, how often it is checked, and (on Agency) who the client is. */
import { z } from 'zod';
import {
  EmailSchema,
  HostSchema,
  IdSchema,
  IsoWeekdaySchema,
  SlackChannelSchema,
  TimestampSchema,
  TimeZoneSchema,
} from './common.js';
import { CadenceSchema } from './enums.js';
import { rules } from './rules.js';

export const SiteSchema = z
  .strictObject({
    id: IdSchema,
    /** Null for an audit nobody has kept yet: it is visible for 24 hours, then purged at 30 days. */
    account_id: IdSchema.nullable(),
    host: HostSchema,
    /** A staging or preview host audited on each deploy points at the production site it belongs to. */
    staging_of_site_id: IdSchema.nullable(),
    client_name: z.string().nullable(),
    /** The person at the client the agency writes to ("Email the robots.txt fix to Maya"). */
    client_contact_name: z.string().min(1).nullable(),
    client_contact_email: EmailSchema.nullable(),
    /** Null when nothing re-checks the site ("Next check: none scheduled"). */
    schedule: z
      .strictObject({
        cadence: CadenceSchema,
        iso_weekday: IsoWeekdaySchema.nullable(),
        hour_local: z.int().min(0).max(23).nullable(),
      })
      .nullable(),
    /** Paused at trial end until Pro is chosen or the site is removed; history is kept. */
    paused: z.boolean(),
    competitor_hosts: z.array(HostSchema),
    slack_channel: SlackChannelSchema.nullable(),
    owner_seat_id: IdSchema.nullable(),
    client_report: z
      .strictObject({
        /** weekly, or monthly on the first `iso_weekday` of the month ("monthly, first Mon"). */
        cadence: CadenceSchema,
        iso_weekday: IsoWeekdaySchema,
        /** Clock time in `timezone`, the CLIENT's zone ("Mon 08:00 their time"), not the agency's. */
        time_local: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
        timezone: TimeZoneSchema,
        send_when_unchanged: z.boolean(),
        open_tracking: z.boolean(),
        /** The path on the agency's report domain: `portal_domain`/`page_slug`. */
        page_slug: z.string().regex(/^[a-z0-9-]+$/),
        /** Set when the recipient used "Pause these reports" in a report footer (FACTS D6). */
        paused_by_recipient_at: TimestampSchema.nullable(),
      })
      .nullable(),
    created_at: TimestampSchema,
  })
  .check(
    rules((s, rule) => {
      const sch = s.schedule;
      if (sch) {
        const timed = sch.cadence !== 'on_deploy';
        // Together: a timed schedule has both a weekday and an hour, and on_deploy has neither.
        rule.exactlyWhen('schedule_timed', timed, sch.iso_weekday !== null);
        rule.exactlyWhen('schedule_pair', sch.iso_weekday !== null, sch.hour_local !== null);
      }
      if (s.account_id === null && (s.schedule || s.client_report || s.owner_seat_id)) {
        rule.fail('unkept_audit');
      }
      if (s.client_report?.cadence === 'on_deploy') rule.fail('client_report_cadence');
    }),
  );

export type Site = z.infer<typeof SiteSchema>;
