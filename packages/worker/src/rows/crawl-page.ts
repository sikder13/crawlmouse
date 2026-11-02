import { z } from 'zod';
import { CAPS } from './bounded.js';
import {
  ContentSimhashSchema,
  CountSchema,
  crawledText,
  DeclaredCanonicalSchema,
  EvidenceClassSchema,
  HeaderSchema,
  HreflangSchema,
  HttpStatusSchema,
  HttpUrlSchema,
  IdSchema,
  MAX_HEADERS,
  RedirectChainSchema,
  SearchRobotsSchema,
  SourceIpClassSchema,
  TimestampSchema,
} from '@crawlmouse/types/v2';

/**
 * CrawlPage: one URL in one crawl batch, and what our crawl identity got back.
 *
 * Not a contract PageResult: a PageResult needs depth, inbound links, PageRank share and a page kind,
 * which only the whole crawl's graph can give. This row carries what one request shows, built from
 * the contract's primitives and page-fact schemas, and the graders assemble PageResult from these
 * rows and the LinkEdges.
 */

export const RAW_TEXT_BYTES = CAPS.rawText.bytes;

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
  /** Distinct same-host links found on the page, including any not recorded as edges. */
  links_out: CountSchema.nullable(),
  /**
   * The contract's page facts (packages/types/src/v2/page-facts.ts), as PageResult carries them:
   * the redirects behind `final_url` (null when no response came back); the rel=canonical as the page
   * wrote it, any host (null when not read, or not kept); its hreflang alternates (null when not
   * read, or not recorded for the batch's room); the main-content simhash (null when not read or too
   * short); whether every link on the page was read; robots.txt's verdict for each search engine.
   */
  redirect: RedirectChainSchema.nullable(),
  canonical_declared: DeclaredCanonicalSchema.nullable(),
  hreflang: HreflangSchema.nullable(),
  content_simhash: ContentSimhashSchema.nullable(),
  /** The response was HTML by its Content-Type; false for a non-HTML resource, or no response. */
  is_html: z.boolean(),
  links_read: z.boolean(),
  robots_search: SearchRobotsSchema,
});

export type CrawlPage = z.infer<typeof CrawlPageSchema>;
