/**
 * FixEvent: the append-only history of a fix. Events are never edited or removed; a fix's status is
 * the consequence of its last event (none = `open`).
 *
 * marked_done records who (null when it was marked from an audit nobody has kept, which has no seats);
 * verified, unable_to_verify and reopened record the check that measured it.
 */
import { z } from 'zod';
import { IdSchema, TimestampSchema } from './common.js';

const base = { id: IdSchema, fix_id: IdSchema, at: TimestampSchema };

export const FixEventSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...base, kind: z.literal('marked_done'), by_seat_id: IdSchema.nullable() }),
  z.strictObject({ ...base, kind: z.literal('verified'), check_id: IdSchema }),
  z.strictObject({ ...base, kind: z.literal('unable_to_verify'), check_id: IdSchema }),
  z.strictObject({ ...base, kind: z.literal('reopened'), check_id: IdSchema }),
]);

export type FixEvent = z.infer<typeof FixEventSchema>;
