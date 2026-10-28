/** AlertRule: when a change sends a note. Account-wide (`site_id` null) or a per-site override. */
import { z } from 'zod';
import { IdSchema, TimestampSchema } from './common.js';
import { AlertRuleKindSchema, ChannelSchema } from './enums.js';
import { rules } from './rules.js';

export const AlertRuleSchema = z
  .strictObject({
    id: IdSchema,
    account_id: IdSchema,
    site_id: IdSchema.nullable(),
    kind: AlertRuleKindSchema,
    enabled: z.boolean(),
    /** "drops more than 10 points"; only the text-drop rule has one. */
    threshold_points: z.number().min(0).max(100).nullable(),
    channels: z.array(ChannelSchema),
    last_fired_at: TimestampSchema.nullable(),
    last_fired_check_id: IdSchema.nullable(),
  })
  .check(
    rules((r, rule) => {
      rule.exactlyWhen('alert_threshold', r.kind === 'text_drop', r.threshold_points !== null);
      rule.exactlyWhen(
        'alert_fired_pair',
        r.last_fired_at === null,
        r.last_fired_check_id === null,
      );
    }),
  );

export type AlertRule = z.infer<typeof AlertRuleSchema>;
