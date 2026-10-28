import { z } from 'zod';
import {
  CountSchema,
  crawledText,
  EvidenceClassSchema,
  HeaderSchema,
  HttpStatusSchema,
  HttpUrlSchema,
  IdSchema,
  MAX_HEADERS,
  SourceIpClassSchema,
  TimestampSchema,
} from '@crawlmouse/types/v2';

/**
 * CrawlPage: one URL in one crawl batch, and what our crawl identity got back.
 *
 * Not a contract PageResult: a PageResult needs depth, inbound links, PageRank share and a page kind,
 * which only the whole crawl's graph can give. This row carries what one request shows, built from
 * the contract's primitives, and the graders assemble PageResult from these rows and the LinkEdges.
 */

export const RAW_TEXT_BYTES = 64 * 1024;

export const CrawlOutcomeSchema = z.enum([
  'fetched',
  'robots_disallowed',
  'not_requested',
  'failed',
]);

export const CrawlPageSchema = z.strictObject({
  check_id: IdSchema,
  url: HttpUrlSchema,
  outcome: CrawlOutcomeSchema,
  /** How the response read (served, refused, challenged, ...); null when nothing came back. */
  response: z
    .enum([
      'served',
      'refused',
      'gone',
      'challenged',
      'rate_limited',
      'payment',
      'redirected_away',
      'error',
    ])
    .nullable(),
  evidence_class: EvidenceClassSchema,
  identity_sent: crawledText(512, 1),
  source_ip_class: SourceIpClassSchema,
  limitations: z.array(z.string().min(1).max(500)).max(8),
  fetched_at: TimestampSchema,
  request_headers: z.array(HeaderSchema).max(MAX_HEADERS),
  status_code: HttpStatusSchema.nullable(),
  final_url: HttpUrlSchema.nullable(),
  headers: z.array(HeaderSchema).max(MAX_HEADERS),
  byte_count: CountSchema.nullable(),
  word_count: CountSchema.nullable(),
  /** The served text, cut to RAW_TEXT_BYTES; null unless an HTML page was served. */
  raw_text: crawledText(RAW_TEXT_BYTES).nullable(),
  /** A same-host rel=canonical that differs from the page's own URL. */
  canonical_url: HttpUrlSchema.nullable(),
  /** Distinct same-site links found on the page, including any not recorded as edges. */
  links_out: CountSchema.nullable(),
});

export type CrawlPage = z.infer<typeof CrawlPageSchema>;
