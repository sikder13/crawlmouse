/**
 * UsageEvent: one delivered result (a finished check, an export, later an API call), and what it cost
 * us to produce. Account-scoped: an audit nobody kept is not metered here (its volume is counted in
 * PostHog). A refused, withheld or failed result is recorded and is never billable.
 */
import { z } from 'zod';
import { IdSchema, TimestampSchema } from './common.js';
import { UsageKindSchema, UsageResultSchema } from './enums.js';
import { rules } from './rules.js';

export const UsageEventSchema = z
  .strictObject({
    id: IdSchema,
    account_id: IdSchema,
    kind: UsageKindSchema,
    /** The check the result came from; null once that check is deleted, or for a result of none. */
    check_id: IdSchema.nullable(),
    /** The report that was exported; null once it is deleted, or for a result of none. */
    report_id: IdSchema.nullable(),
    result: UsageResultSchema,
    billable: z.boolean(),
    /** Worker and server time spent, in seconds. */
    compute_seconds: z.number().min(0),
    /** Requests made to sites to produce it. */
    request_count: z.int().min(0),
    occurred_at: TimestampSchema,
  })
  .check(
    rules((u, rule) => {
      if (u.billable && u.result !== 'delivered') rule.fail('usage_billable');
    }),
  );

export type UsageEvent = z.infer<typeof UsageEventSchema>;
