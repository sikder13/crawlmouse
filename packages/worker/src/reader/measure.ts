import { readRendered, type RenderedReading } from '@crawlmouse/engine/worker';
import { z } from 'zod';
import { parseJsonStrict } from '../auth/jwt.js';
import type { NotRead } from './read.js';

/**
 * A POST /render/measure body, read on the measure thread (questions/042, design C): the route hands
 * the thread the body's bytes as they arrived, so decoding, parsing and both renders' reading all run
 * there, under its deadline and heap, and never on the worker's event loop.
 */
export const MeasureRequestSchema = z.strictObject({
  static_html: z.string(),
  rendered_html: z.string(),
  url: z.string().url().max(2048),
});

export type MeasureReply = { reading: RenderedReading } | { invalid: 'json' | string[] };

/**
 * What POST /render/measure reads on. Only a ThreadReader is one, because only it stops a read at its
 * deadline and under its heap; the route refuses `reader_unavailable` without it.
 */
export interface MeasureReader {
  measure(bytes: Uint8Array): Promise<MeasureReply | NotRead>;
  /** Threads started after the first, each because the one before it died or was stopped. */
  readonly restarts?: number;
}

/** Keeps a leading byte-order mark, as the sides were sent: a stripped one would shift the text. */
const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

export function readMeasure(bytes: Uint8Array): MeasureReply {
  let parsed: unknown;
  try {
    parsed = parseJsonStrict(decoder.decode(bytes));
  } catch {
    return { invalid: 'json' };
  }
  const checked = MeasureRequestSchema.safeParse(parsed);
  if (!checked.success) {
    return {
      invalid: [...new Set(checked.error.issues.map((i) => i.path.join('.') || '(root)'))],
    };
  }
  const { static_html, rendered_html, url } = checked.data;
  return { reading: readRendered(static_html, rendered_html, url) };
}
