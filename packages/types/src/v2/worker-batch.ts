/**
 * What the crawl worker (`packages/worker`) returns for one batch: its rows, and what limited it.
 *
 * The worker builds these values; the engine and the app parse them. They live here, not in the worker,
 * so a consumer can parse a batch result without depending on the worker package (the worker depends
 * on the engine, so the engine cannot depend on it). Every object is strict: a field this module does
 * not name is refused, so a worker that starts sending one breaks a test here before it reaches a
 * consumer that would ignore it.
 */
import { z } from 'zod';
import {
  AccessTestSchema,
  FlyRegionSchema,
  RequestTimingSchema,
  WorkerReleaseSchema,
} from './access-test.js';
import {
  CountSchema,
  crawledText,
  HeaderSchema,
  HttpStatusSchema,
  HttpUrlSchema,
  IdSchema,
  MAX_HEADERS,
  TimestampSchema,
} from './common.js';
import { BatchPartialSchema, DeclarationFetchSchema } from './declaration.js';
import {
  EvidenceClassSchema,
  RequestSigningSchema,
  SignatureVerificationSchema,
  SourceIpClassSchema,
} from './enums.js';
import { LinkEdgeSchema } from './link-edge.js';
import {
  ContentSimhashSchema,
  DeclaredCanonicalSchema,
  HreflangSchema,
  RedirectChainSchema,
  SearchRobotsSchema,
} from './page-facts.js';
import { CmsNameSchema } from './enums.js';
import { rules } from './rules.js';
import { MetaDescriptionSchema, PageTitleSchema } from './page-result.js';

/** The served text a crawl row keeps, in UTF-8 bytes. */
export const CRAWL_RAW_TEXT_BYTES = 64 * 1024;
/** What a stored origin or site key may hold: an origin comes from a URL within the URL cap. */
const ORIGIN_BYTES = 2048;
const SITE_BYTES = 253;
/** The excerpt of robots.txt a batch result keeps as evidence. */
export const ROBOTS_EXCERPT_BYTES = 2000;

// ─── One crawl row ─────────────────────────────────────────────────────────────────────────────

export const CrawlOutcomeSchema = z.enum([
  'fetched',
  'robots_disallowed',
  'not_requested',
  'failed',
]);

export const CrawlResponseSchema = z.enum([
  'served',
  'refused',
  'gone',
  'challenged',
  'rate_limited',
  'payment',
  'redirected_away',
  'error',
]);

// ─── What the content checks and the stack read of a page, carried on its row ──────────────────

/** The most JSON-LD nodes, and types per node, a row keeps; a page past either keeps no features. */
export const MAX_JSON_LD_NODES = 256;
export const MAX_JSON_LD_TYPES = 32;
export const JSON_LD_TYPE_BYTES = 256;
/** The most a row's content features may take, serialised as JSON. */
export const CONTENT_FEATURES_BYTES = 64 * 1024;

const ContentBlockSchema = z.strictObject({
  tag: z.string().regex(/^[a-z][a-z0-9]*$/),
  words: z.int().min(1),
  answer_sentences: CountSchema,
  question: z.boolean(),
});

/**
 * What the engine's content reader (`packages/engine/src/v2/content/read.ts` readPage) reads of one
 * page's static HTML, read by the worker from the same bytes it counted words on. It holds no page
 * text: block shapes, heading counts, JSON-LD types and flags, byline markup and specification counts.
 * The engine's `ContentFeatures` type and this schema are held equal in both directions by
 * packages/engine/src/v2/build/contract-fit.test.ts.
 */
export const ContentFeaturesSchema = z.strictObject({
  client_rendered: z.boolean(),
  has_h1: z.boolean(),
  words_after_h1: CountSchema,
  opening: z.array(ContentBlockSchema),
  headings: z.strictObject({
    count: CountSchema,
    questions: CountSchema,
    section_questions: CountSchema,
  }),
  json_ld: z
    .array(
      z.strictObject({
        types: z.array(crawledText(JSON_LD_TYPE_BYTES)).max(MAX_JSON_LD_TYPES),
        has_description: z.boolean(),
        has_author: z.boolean(),
        has_dated_publication: z.boolean(),
      }),
    )
    .max(MAX_JSON_LD_NODES),
  byline: z.strictObject({
    meta_author: z.boolean(),
    published_time: z.boolean(),
    rel_author: z.boolean(),
    itemprop_author: z.boolean(),
    itemprop_date: z.boolean(),
    time_datetime: z.boolean(),
  }),
  specs: z.strictObject({
    structured: CountSchema,
    label_value_lines: CountSchema,
    spec_images: CountSchema,
  }),
});

export type ContentFeaturesRow = z.infer<typeof ContentFeaturesSchema>;

/** The CMS a page's HTML and response headers point to (v1's detectCms), and what it was read from. */
export const StackSignalsSchema = z.strictObject({
  cms: CmsNameSchema,
  detected_from: z.string().min(1).max(200),
});

/**
 * CrawlPage: one URL in one crawl batch, and what our crawl identity got back.
 *
 * Not a contract PageResult: a PageResult needs depth, inbound links, PageRank share and a page kind,
 * which only the whole crawl's graph can give. This row carries what one request shows, and the
 * check builder (packages/engine/src/v2/build) assembles PageResult from these rows and the LinkEdges.
 */
export const CrawlPageSchema = z.strictObject({
  check_id: IdSchema,
  url: HttpUrlSchema,
  outcome: CrawlOutcomeSchema,
  /** How the response read (served, refused, challenged, ...); null when nothing came back. */
  response: CrawlResponseSchema.nullable(),
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
  /** The served text, cut to CRAWL_RAW_TEXT_BYTES; null unless an HTML page was served. */
  raw_text: crawledText(CRAWL_RAW_TEXT_BYTES).nullable(),
  /** A same-host rel=canonical that differs from the page's own URL. */
  canonical_url: HttpUrlSchema.nullable(),
  /** Distinct same-host links found on the page, including any not recorded as edges. */
  links_out: CountSchema.nullable(),
  /**
   * The contract's page facts (page-facts.ts), as PageResult carries them: the redirects behind
   * `final_url` (null when no response came back); the rel=canonical as the page wrote it, any host
   * (null when not read, or not kept); its hreflang alternates (null when not read, or not recorded for
   * the batch's room); the main-content simhash (null when not read or too short); whether every link
   * on the page was read; robots.txt's verdict for each search engine.
   */
  redirect: RedirectChainSchema.nullable(),
  canonical_declared: DeclaredCanonicalSchema.nullable(),
  hreflang: HreflangSchema.nullable(),
  content_simhash: ContentSimhashSchema.nullable(),
  /** The page's own response was HTML; false for a non-HTML resource, or none. */
  is_html: z.boolean(),
  links_read: z.boolean(),
  robots_search: SearchRobotsSchema,
  /** PageResult's title and meta description; null when the page was not read. */
  title: PageTitleSchema.nullable(),
  meta_description: MetaDescriptionSchema.nullable(),
  /** The vantage AccessTest records, with its shapes: region (null off Fly), signing, release. */
  fly_region: FlyRegionSchema.nullable(),
  request_signing: RequestSigningSchema,
  signature_verified: SignatureVerificationSchema,
  worker_release: WorkerReleaseSchema,
  /** The request's timing (AccessTest's); null when no request was made. */
  timing: RequestTimingSchema.nullable(),
  /**
   * The page's content features; null when the page was not read whole, or its features passed the
   * bounds above (the row's limitations say which), or the batch had used its room for page text.
   */
  content_features: ContentFeaturesSchema.nullable(),
  /** Read on a batch's first URL only, when it was read as HTML; null on every other row. */
  stack_signals: StackSignalsSchema.nullable(),
  /**
   * The length, in characters, of the page's main content as v1's extractMainContent gives it (the
   * page classifier's thin-content signal); null when the page was not read whole.
   */
  main_text_chars: CountSchema.nullable(),
  /**
   * The page told search engines not to index it: `noindex` or `none` in a robots, googlebot or bingbot
   * meta tag, or in an X-Robots-Tag header (v1's two rules). True on the header alone; otherwise null
   * when the page was not read whole.
   */
  noindex: z.boolean().nullable(),
});

export type CrawlOutcome = z.infer<typeof CrawlOutcomeSchema>;
export type CrawlPage = z.infer<typeof CrawlPageSchema>;

// ─── What a batch met ──────────────────────────────────────────────────────────────────────────

export const RobotsStateSchema = z.enum(['rules', 'none', 'unreachable', 'too_large', 'refused']);
/** Why a robots.txt reading is in its state: for `none`, `unreachable` and `too_large`. */
export const RobotsWhySchema = z.enum([
  'client_error',
  'html_soft_404',
  'server_error',
  'timeout',
  'network',
  'challenged',
  'byte_budget',
  'redirect_status',
  'bytes',
  'rules',
]);
export const SiteStopReasonSchema = z.enum([
  'three_429_responses',
  'four_consecutive_challenged_pages',
]);
export const BudgetKindSchema = z.enum(['requests', 'bytes', 'seconds']);
export const NotReadReasonSchema = z.enum([
  'parse_depth_exceeded',
  'reader_thread_crashed',
  'reader_deadline',
  'reader_error',
]);

/** robots.txt as one origin answered it for the batch, as evidence. */
export const RobotsEvidenceSchema = z
  .strictObject({
    origin: crawledText(ORIGIN_BYTES, 1),
    /** The user agent robots.txt was requested with: always our crawler's. */
    identity_sent: crawledText(512, 1),
    state: RobotsStateSchema,
    why: RobotsWhySchema.nullable(),
    status: HttpStatusSchema.nullable(),
    final_url: HttpUrlSchema.nullable(),
    fetched_at: TimestampSchema,
    from_cache: z.boolean(),
    crawl_delay_s: z.number().min(0).nullable(),
    body_excerpt: crawledText(ROBOTS_EXCERPT_BYTES).nullable(),
    /**
     * The whole file, as served, when the worker read all of it (within the engine's 500 KiB parse
     * limit) as rules and could store it unchanged; null otherwise. `body_complete` says which.
     */
    body: z.string().nullable(),
    body_complete: z.boolean(),
  })
  .check(
    rules((r, rule) => {
      rule.exactlyWhen('robots_body', r.body !== null, r.body_complete);
    }),
  );

export type RobotsEvidence = z.infer<typeof RobotsEvidenceSchema>;

/** What a batch met that limited it, recorded once each. */
export const FindingSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('site_stopped'),
    site: crawledText(SITE_BYTES, 1),
    reason: SiteStopReasonSchema,
    at: TimestampSchema,
    until: TimestampSchema,
    /** False when the stop came with the batch's last request, so it refused none of them. */
    requests_refused: z.boolean(),
  }),
  z.strictObject({ kind: z.literal('budget_spent'), budget: BudgetKindSchema }),
  z.strictObject({
    kind: z.literal('robots_unreachable'),
    origin: crawledText(ORIGIN_BYTES, 1),
    why: RobotsWhySchema.exclude(['client_error', 'html_soft_404', 'bytes', 'rules']),
  }),
  z.strictObject({
    kind: z.literal('robots_too_large'),
    origin: crawledText(ORIGIN_BYTES, 1),
    why: RobotsWhySchema.extract(['bytes', 'rules']),
  }),
  z.strictObject({ kind: z.literal('site_refused'), origin: crawledText(ORIGIN_BYTES, 1) }),
  z.strictObject({
    kind: z.literal('crawl_delay'),
    origin: crawledText(ORIGIN_BYTES, 1),
    declared_s: z.number().min(0),
    honoured: z.boolean(),
  }),
  z.strictObject({ kind: z.literal('result_size_limit'), limit_bytes: z.int().min(1) }),
  /** Responses fetched and not read, by why; none of them a fault of the site. Not a partial reason. */
  z.strictObject({
    kind: z.literal('not_read'),
    reason: NotReadReasonSchema,
    responses: z.int().min(1),
  }),
]);

export type Finding = z.infer<typeof FindingSchema>;

// ─── The batch result ──────────────────────────────────────────────────────────────────────────

const common = {
  batch_id: z.string().regex(/^[0-9a-f-]{36}:\d+$/),
  check_id: IdSchema,
  site_id: IdSchema,
  started_at: TimestampSchema,
  finished_at: TimestampSchema,
  requests: CountSchema,
  bytes: CountSchema,
  coverage: z.strictObject({ urls_requested: CountSchema, urls_complete: CountSchema }),
  /** Null when the batch did everything it was asked; otherwise why it did not. */
  partial: BatchPartialSchema,
  findings: z.array(FindingSchema),
  robots: z.array(RobotsEvidenceSchema),
  /** The declaration files a crawl batch requested, once each; none for access. */
  declarations: z.array(DeclarationFetchSchema),
};

export const AccessBatchResultSchema = z.strictObject({
  ...common,
  kind: z.literal('access'),
  access_tests: z.array(AccessTestSchema),
});

export const CrawlBatchResultSchema = z.strictObject({
  ...common,
  kind: z.literal('crawl'),
  pages: z.array(CrawlPageSchema),
  link_edges: z.array(LinkEdgeSchema),
  /** Link targets the batch found that it neither requested nor landed on, in canonical spelling. */
  discovered_urls: z.array(HttpUrlSchema),
});

export const BatchResultSchema = z.discriminatedUnion('kind', [
  AccessBatchResultSchema,
  CrawlBatchResultSchema,
]);

export type AccessBatchResult = z.infer<typeof AccessBatchResultSchema>;
export type CrawlBatchResult = z.infer<typeof CrawlBatchResultSchema>;
export type BatchResult = z.infer<typeof BatchResultSchema>;

/** The value sets above, by name, as the contract spec lists them. */
export const WORKER_BATCH_ENUMS = {
  CrawlOutcome: CrawlOutcomeSchema,
  CrawlResponse: CrawlResponseSchema,
  RobotsState: RobotsStateSchema,
  RobotsWhy: RobotsWhySchema,
  SiteStopReason: SiteStopReasonSchema,
  BudgetKind: BudgetKindSchema,
  NotReadReason: NotReadReasonSchema,
} as const;
