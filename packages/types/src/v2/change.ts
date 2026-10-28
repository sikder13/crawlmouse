/** Change: something a check found different from the check before it, and who was told. */
import { z } from 'zod';
import {
  CountSchema,
  crawledText,
  IdSchema,
  ScoreSchema,
  SlackChannelSchema,
  TimestampSchema,
} from './common.js';
import {
  ChangeKindSchema,
  ChangeSubjectSchema,
  ChannelSchema,
  GradeLetterSchema,
  GradeNameSchema,
} from './enums.js';

export const ChangeSchema = z.strictObject({
  id: IdSchema,
  site_id: IdSchema,
  check_id: IdSchema,
  previous_check_id: IdSchema.nullable(),
  detected_at: TimestampSchema,
  kind: ChangeKindSchema,
  subject: ChangeSubjectSchema,
  summary: z.string().min(1),
  /** Where on the site: "robots.txt", "/collections/*". */
  where: z.string().min(1),
  pages_affected: CountSchema,
  ua: z.string().min(1).nullable(),
  grade_deltas: z.array(
    z.strictObject({
      grade: GradeNameSchema,
      from_score: ScoreSchema,
      to_score: ScoreSchema,
      from_grade: GradeLetterSchema,
      to_grade: GradeLetterSchema,
    }),
  ),
  /** "Cause we found". */
  cause: z
    .strictObject({
      text: z.string().min(1),
      changed_at: TimestampSchema.nullable(),
      /** The lines of robots.txt (or another file) that changed, quoted from the site, so bounded. */
      diff: z
        .strictObject({
          removed: z.array(crawledText(500)).max(50),
          added: z.array(crawledText(500)).max(50),
        })
        .nullable(),
    })
    .nullable(),
  /** The fix this change opened or resolved. */
  fix_id: IdSchema.nullable(),
  notified: z
    .strictObject({
      channels: z.array(ChannelSchema).min(1),
      slack_channel: SlackChannelSchema.nullable(),
      sent_at: TimestampSchema,
    })
    .nullable(),
});

export type Change = z.infer<typeof ChangeSchema>;
