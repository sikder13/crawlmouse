/** Seat: a person on an account, their role, which clients they see and where their alerts go. */
import { z } from 'zod';
import { EmailSchema, IdSchema, TimestampSchema } from './common.js';
import { ChannelSchema, SeatRoleSchema, ThemeSchema } from './enums.js';

export const SeatSchema = z.strictObject({
  id: IdSchema,
  account_id: IdSchema,
  email: EmailSchema,
  name: z.string().nullable(),
  role: SeatRoleSchema,
  /** "all 12", or the site ids this seat is assigned. */
  client_scope: z.union([z.literal('all'), z.array(IdSchema).min(1)]),
  alert_channels: z.array(ChannelSchema),
  /** System / Light / Dark, per person; System by default. */
  theme: ThemeSchema,
  invited_at: TimestampSchema,
  accepted_at: TimestampSchema.nullable(),
});

export type Seat = z.infer<typeof SeatSchema>;
