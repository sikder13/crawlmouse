/**
 * What a worker batch result carries besides its rows, as fields the engine reads (CC-15's
 * follow-ups, PR #54): the declaration files a crawl batch requested, and why a batch did less than it
 * was asked.
 *
 * A declaration request is recorded as its status, media type and byte count only. The body is read
 * no further than the worker's keep limit and is never stored, so `bytes_complete` says whether
 * `bytes` is the whole body or what was read of it. The worker keeps what an origin answered for a
 * while, so a later batch may carry an earlier batch's answer (`from_cache`) instead of asking again.
 */
import { z } from 'zod';
import { CountSchema, crawledText, HttpStatusSchema, HttpUrlSchema } from './common.js';
import {
  BatchPartialReasonSchema,
  DeclarationNotRequestedSchema,
  DeclarationPathSchema,
  DeclarationStateSchema,
  type DeclarationPath,
  type SignalKind,
} from './enums.js';
import { rules } from './rules.js';

/** The paths, in the order a batch requests them. */
export const DECLARATION_PATHS = DeclarationPathSchema.options;

/** The signal each path declares; `/sitemap.xml` is a crawl input, not an agent signal. */
export const DECLARATION_SIGNAL: Readonly<Record<DeclarationPath, SignalKind | null>> = {
  '/llms.txt': 'llms_txt',
  '/llms-full.txt': 'llms_full',
  '/.well-known/ucp': 'ucp',
  '/.well-known/mcp': 'mcp_server_card',
  '/.well-known/agent-card.json': 'agent_card',
  '/rsl.xml': 'rsl',
  '/sitemap.xml': null,
};

/** The media types a declaration's Content-Type keeps: the header value, cut to this. */
export const DECLARATION_MEDIA_TYPE_BYTES = 128;

export const DeclarationFetchSchema = z
  .strictObject({
    /** The origin the path was requested on: the batch's first URL's. */
    origin: HttpUrlSchema,
    path: DeclarationPathSchema,
    state: DeclarationStateSchema,
    /** The status answered; null unless `answered`. */
    status: HttpStatusSchema.nullable(),
    /** The Content-Type as sent, cut to its budget; null when none was sent or nothing answered. */
    media_type: crawledText(DECLARATION_MEDIA_TYPE_BYTES).nullable(),
    /**
     * Body bytes read, after any Content-Encoding is undone (a file that is itself gzip, served
     * without one, is counted as sent); with `bytes_complete`, null unless `answered`.
     */
    bytes: CountSchema.nullable(),
    bytes_complete: z.boolean().nullable(),
    not_requested: DeclarationNotRequestedSchema.nullable(),
    /** The answer is an earlier batch's, kept by the worker; this batch did not request it. */
    from_cache: z.boolean(),
  })
  .check(
    rules((d, rule) => {
      const answered = d.state === 'answered';
      rule.exactlyWhen('declaration_answer', d.status !== null, answered);
      rule.exactlyWhen(
        'declaration_bytes',
        d.bytes !== null && d.bytes_complete !== null,
        answered,
      );
      if (!answered && d.media_type !== null) rule.fail('declaration_media_type');
      rule.exactlyWhen(
        'declaration_not_requested',
        d.not_requested !== null,
        d.state === 'not_requested',
      );
      if (d.from_cache && d.state === 'not_requested') rule.fail('declaration_cache_answer');
    }),
  );

export type DeclarationFetch = z.infer<typeof DeclarationFetchSchema>;

/** A batch result's `partial`: null when the batch did all it was asked. */
export const BatchPartialSchema = z
  .strictObject({ reasons: z.array(BatchPartialReasonSchema).min(1) })
  .nullable();

export type BatchPartial = z.infer<typeof BatchPartialSchema>;
