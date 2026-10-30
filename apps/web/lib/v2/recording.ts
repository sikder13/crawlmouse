/**
 * A recorded progress stream: the events of one check, in order, and the moment they cover up to.
 *
 * No recording here comes from the engine. Each is synthesised from a contract fixture by
 * `synthesise.ts`, so `provenance` can only be "synthesised"; a recording captured from the
 * pipeline will carry its own provenance when one exists.
 */
import { z } from 'zod';
import { CountSchema, HostSchema, IdSchema, TimestampSchema } from '@crawlmouse/types/v2';
import { ProgressEventSchema } from './progress';
import { FIXTURE_NAMES } from './fixture-names';

export const RecordingSchema = z
  .strictObject({
    provenance: z.literal('synthesised'),
    fixture: z.enum(FIXTURE_NAMES),
    check_id: IdSchema,
    host: HostSchema,
    started_at: TimestampSchema,
    /** The last moment covered: the end, or for a check still running, the fixture's "now". */
    until_ms: CountSchema,
    events: z.array(ProgressEventSchema),
  })
  .check((ctx) => {
    const { events, until_ms } = ctx.value;
    events.forEach((e, i) => {
      if (i > 0 && e.at_ms < events[i - 1]!.at_ms) {
        ctx.issues.push({ code: 'custom', message: `event ${i} goes back in time`, input: e });
      }
      if (e.at_ms > until_ms) {
        ctx.issues.push({ code: 'custom', message: `event ${i} is after until_ms`, input: e });
      }
    });
    const ended = events.findIndex((e) => e.type === 'ended');
    if (ended !== -1 && ended !== events.length - 1) {
      ctx.issues.push({ code: 'custom', message: 'events follow the end', input: events[ended] });
    }
  });

export type Recording = z.infer<typeof RecordingSchema>;
