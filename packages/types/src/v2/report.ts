/** Report: anything made from checks to keep, share or send: PDFs, exports, links, client reports. */
import { z } from 'zod';
import { CountSchema, EmailSchema, IdSchema, TimestampSchema } from './common.js';
import {
  ReportFormatSchema,
  ReportKindSchema,
  ReportMakerSchema,
  ReportStatusSchema,
} from './enums.js';
import { rules } from './rules.js';

export const ReportSchema = z
  .strictObject({
    id: IdSchema,
    account_id: IdSchema,
    site_id: IdSchema,
    kind: ReportKindSchema,
    format: ReportFormatSchema,
    status: ReportStatusSchema,
    made_by: ReportMakerSchema,
    created_at: TimestampSchema,
    covers_check_ids: z.array(IdSchema).min(1),
    byte_count: CountSchema.nullable(),
    /** A share link to a file works for 30 days. */
    share_expires_at: TimestampSchema.nullable(),
    public_slug: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .nullable(),
    scheduled_for: TimestampSchema.nullable(),
    sent_at: TimestampSchema.nullable(),
    recipient_email: EmailSchema.nullable(),
    owner_seat_id: IdSchema.nullable(),
    headline: z.string().min(1).nullable(),
    open_tracking: z.boolean(),
    opened_at: TimestampSchema.nullable(),
  })
  .check(
    rules((r, rule) => {
      rule.exactlyWhen('report_sent', r.status === 'sent', r.sent_at !== null);
      if ((r.status === 'scheduled' || r.status === 'held') && r.scheduled_for === null) {
        rule.fail('report_send_time');
      }
      rule.exactlyWhen('report_slug', r.kind === 'public_link', r.public_slug !== null);
      if (r.opened_at !== null && !r.open_tracking) rule.fail('report_open_tracking');
    }),
  );

export type Report = z.infer<typeof ReportSchema>;
