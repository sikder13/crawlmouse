/**
 * What the crawler-access detectors read and what they report.
 *
 * The verdict of each crawler on each sampled page is the crawl worker's (CC-12,
 * `packages/worker/src/verdict/table.ts`), carried here unchanged in its `AccessTest` row. The engine
 * decides what those rows add up to: one verdict per crawler for the site, whether the access score
 * can be given, and the two access fix types.
 */
import type {
  AccessCause,
  AccessTest,
  Confidence,
  CrawlerGroup,
  CrawlerRegistryEntry,
  CrawlerResult,
  DetectionState,
  PageResult,
  RecommendationClass,
  Verdict,
} from '@crawlmouse/types/v2';

export interface AccessInput {
  /** Every row of the check's access batches: each crawler's, the control's and the canary's. */
  access_tests: readonly AccessTest[];
  /**
   * The crawled pages, for what robots.txt says to each search engine (`robots_search`). URLs robots.txt
   * kept our crawler from are not read: every crawler is judged on pages our crawler fetched, the
   * sampled pages being among them, so one wildcard rule reads the same for each.
   */
  pages: readonly Pick<PageResult, 'url' | 'template_key' | 'robots_search'>[];
  /** The crawlers to report on; CRAWLER_REGISTRY_V2 when not given. */
  registry?: readonly CrawlerRegistryEntry[];
}

/** One crawler on one page: a worker row, or a search engine's robots.txt reading (`id` null). */
export interface Cell {
  id: string | null;
  page_url: string;
  template_key: string;
  verdict: Verdict;
  cause: AccessCause | null;
  status: number | null;
  evidence_class: AccessTest['evidence_class'];
  headers: AccessTest['headers'];
}

/**
 * A crawler's row of the matrix: the contract's CrawlerResult without `text_share`, which needs the
 * rendered words (CC-14), and with what the contract cannot carry yet.
 */
export interface CrawlerAccess extends Omit<CrawlerResult, 'text_share'> {
  /** How many of the crawler's cells carry each verdict, measured or not. */
  counts: Partial<Record<Verdict, number>>;
  /** The cells that carry the site verdict: their worker rows (none for a search engine) and pages. */
  supporting: { access_test_ids: string[]; pages: string[] };
  /** `respected`: robots.txt disallows the crawler, which is the site's stated intent. */
  intent: 'respected' | null;
}

export type AccessFixType = 'robots_txt_blocks_crawler' | 'edge_rule_blocks_crawler';

/** Why an access detector could not decide. */
export const ACCESS_INDETERMINATE_REASONS = [
  'not_measured',
  'edge_blocks_automation',
  'robots_disallows',
  'challenge_real_crawler_may_pass',
  'refusal_unverified',
  'edge_answered_otherwise',
  'hysteresis_band',
  'robots_not_read',
] as const;
export type AccessIndeterminateReason = (typeof ACCESS_INDETERMINATE_REASONS)[number];

/** One access detector's verdict on one crawler. CC-17 turns a record into the diff's outcome. */
export interface AccessDetection {
  type: AccessFixType;
  /** `FingerprintSchema`: the hash of `key`. */
  fingerprint: string;
  /** The readable key the fingerprint hashes, e.g. `edge:gptbot`. */
  key: string;
  /** The crawler's registry token. */
  crawler: string;
  group: CrawlerGroup;
  scored: boolean;
  state: DetectionState;
  /** Set exactly when `state` is `indeterminate`. */
  reason: AccessIndeterminateReason | null;
  /** The share of the crawler's judged pages the problem holds on; null when none was judged. */
  measured: number | null;
  recommendation_class: RecommendationClass;
  confidence: Confidence;
  /** `respected`: the block is robots.txt's, which states the site's intent. */
  intent: 'respected' | null;
  /** A detected record that may open a fix. A respected-intent detection never does on its own. */
  opens_fix: boolean;
  /** The pages the problem holds on, sorted: empty unless detected. */
  affected_urls: string[];
  evidence: {
    /** The worker rows behind the record, sorted. */
    access_test_ids: string[];
    pages: string[];
    /** The causes those rows name, sorted. */
    causes: AccessCause[];
    /** What their responses showed, built from the recorded headers, sorted. */
    signatures: string[];
  };
}

export interface AccessResult {
  /** One row per crawler, in registry order. */
  crawlers: CrawlerAccess[];
  /** Scored crawlers with a measured verdict (the contract's `scoredCrawlersMeasured`). */
  scored_measured: number;
  /** Fewer than two scored crawlers measured: the access score is withheld (FACTS I4). */
  access_withheld: boolean;
  /** Sorted by fix type, then key. */
  detections: AccessDetection[];
}
