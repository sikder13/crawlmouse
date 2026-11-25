import { z } from 'zod';

/**
 * The worker's note that a batch ended (PR 5a): ids and an outcome, and nothing else. Batch 0 is the
 * daily sentinel's look (lib/v2/monitor/sentinel-work.ts posts its access batch as 0); a check's own
 * batches count from 1 (F-333).
 */
const NoteSchema = z.strictObject({
  check_id: z.string().uuid(),
  batch: z.number().int().min(0).max(9_999_999),
  status: z.enum(['done', 'failed']),
});
export type WorkerNote = z.infer<typeof NoteSchema>;

/** The note in this text, or null when it is not one. */
export function parseWorkerNote(raw: string): WorkerNote | null {
  try {
    const note = NoteSchema.safeParse(JSON.parse(raw));
    return note.success ? note.data : null;
  } catch {
    return null;
  }
}
