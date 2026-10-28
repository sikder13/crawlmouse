/**
 * AccessTest: one request (or one robots.txt reading, or one owner log line) and what came back.
 * The raw evidence behind a CrawlerResult.
 *
 * `ua` is null for the untagged browser-identity control fetch and for renders: those are part of the
 * method (FACTS D1/L5) but are not any crawler.
 */
import { z } from 'zod';
import {
  CountSchema,
  crawledText,
  HeaderSchema,
  MAX_HEADERS,
  HttpStatusSchema,
  HttpUrlSchema,
  IdSchema,
  TemplateKeySchema,
  TimestampSchema,
} from './common.js';
import {
  AccessCauseSchema,
  EvidenceClassSchema,
  SourceIpClassSchema,
  VerdictSchema,
} from './enums.js';
import { rules } from './rules.js';

export const AccessTestSchema = z
  .strictObject({
    id: IdSchema,
    check_id: IdSchema,
    ua: z.string().min(1).nullable(),
    page_url: HttpUrlSchema,
    template_key: TemplateKeySchema,
    tested_at: TimestampSchema,
    verdict: VerdictSchema,
    evidence_class: EvidenceClassSchema,
    /** The User-Agent actually sent, tag included; an owner-log line can carry any string, so bounded. */
    identity_sent: crawledText(512, 1),
    source_ip_class: SourceIpClassSchema,
    /** What this evidence cannot show, said plainly. */
    limitations: z.array(z.string().min(1).max(500)).max(8),
    cause: AccessCauseSchema.nullable(),
    request_headers: z.array(HeaderSchema).max(MAX_HEADERS),
    raw_status: HttpStatusSchema.nullable(),
    final_url: HttpUrlSchema.nullable(),
    /** Only the response headers that bear on the verdict. */
    headers: z.array(HeaderSchema).max(MAX_HEADERS),
    byte_count: CountSchema.nullable(),
    word_count: CountSchema.nullable(),
    /** The start of the body as received, cut by the engine to 2,000 UTF-8 bytes. */
    body_excerpt: crawledText(2000).nullable(),
  })
  .check(
    rules((t, rule) => {
      const observed = t.evidence_class === 'observed';
      rule.exactlyWhen('observed_owner_logs', observed, t.source_ip_class === 'owner_logs');
    }),
  );

export type AccessTest = z.infer<typeof AccessTestSchema>;
