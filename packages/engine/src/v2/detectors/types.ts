/**
 * What the structure detectors read and what they report.
 *
 * The contract's records (`PageResult`, `LinkEdge`, `Check`) carry most of a check. `PageFacts` holds
 * what one request showed that the contract does not store yet (redirect hops, the declared canonical,
 * the content hash, hreflang). Every field there is nullable, and null means "not read": a detector
 * that needs a null field reports `indeterminate` for it rather than assuming a value.
 *
 * URLs: every URL here is in the engine's canonical spelling (`canonicalizeUrl`), the spelling the
 * contract's `LinkEdge` uses. `PageResult.url` is the URL that was requested, which is what links
 * point at; where the request ended is `PageFacts.final_url`.
 */
import type {
  Check,
  Coverage,
  DetectionState,
  FixType,
  LinkEdge,
  PageResult,
} from '@crawlmouse/types/v2';

export interface RedirectHops {
  /** Redirect responses between the requested URL and the final one. */
  hops: number;
  /** The chain came back to a URL it had already visited. */
  loop: boolean;
}

export interface HreflangLink {
  /** The `hreflang` value as written. */
  lang: string;
  /** The alternate's URL, resolved and canonicalised. */
  href: string;
}

export interface PageFacts {
  url: string;
  /** The URL that finally answered without a redirect; null when not recorded or never reached. */
  final_url: string | null;
  /** The redirect chain behind `final_url`; null when not recorded. */
  redirect: RedirectHops | null;
  /**
   * The page's `rel=canonical`: null when not read; `{ href: null }` when the page declares none.
   * `href` is resolved against the page and canonicalised, and kept even when it is another host.
   */
  canonical: { href: string | null } | null;
  /** A 64-bit simhash of the main content (`simhashForDedup`); null when not computed. */
  simhash: string | null;
  /** The page's hreflang alternates; null when not read. */
  hreflang: readonly HreflangLink[] | null;
}

export interface DetectorInput {
  check: Pick<Check, 'status' | 'coverage'>;
  /** The most pages the crawl was allowed to fetch (`CheckSide.page_cap`). */
  page_cap: number;
  /** The URL the crawl started from, in canonical spelling. */
  homepage_url: string;
  pages: readonly PageResult[];
  edges: readonly LinkEdge[];
  facts: readonly PageFacts[];
  /** URLs robots.txt kept the crawl from requesting; null when not recorded. */
  robots_disallowed: readonly string[] | null;
  /** The previous graded check's coverage, for comparing samples; null when there is none. */
  previous_coverage: Coverage | null;
}

/** Why a detector could not decide. */
export const INDETERMINATE_REASONS = [
  'crawl_truncated',
  'links_not_fully_recorded',
  'not_crawled',
  'page_gone',
  'homepage_not_crawled',
  'sample_changed',
  'too_few_links',
  'hysteresis_band',
  'hops_not_recorded',
  'first_page_not_crawled',
  'content_not_hashed',
  'canonical_not_read',
  'canonical_target_not_fetched',
  'canonical_target_errored',
  'member_not_crawled',
] as const;
export type IndeterminateReason = (typeof INDETERMINATE_REASONS)[number];

/** A specific problem a detector proved, for the fix types that have more than one kind. */
export const CONDITIONS = [
  'redirect_loop',
  'pagination_near_duplicate',
  'pagination_canonical_to_first',
  'canonical_cross_host',
  'canonical_target_not_200',
  'canonical_target_disallowed',
  'canonical_target_not_canonical',
  'linked_under_non_canonical',
  'hreflang_missing_self',
  'hreflang_missing_return',
  'hreflang_missing_x_default',
  'hreflang_invalid_code',
] as const;
export type Condition = (typeof CONDITIONS)[number];

/**
 * One detector's verdict on one fingerprint. CC-17 turns a `detected` record into a `FixDraft`.
 *
 * `page_gone`: set when the subject page answered 404 or 410 on this check. Its record is
 * `indeterminate` (reason `page_gone`), so the fix is never verified as fixed by the page's absence;
 * "removed" is a state the contract cannot express yet, and this field is what CC-17 will map to it.
 */
export interface Detection {
  type: FixType;
  /** `FingerprintSchema`: the hash of `key`. */
  fingerprint: string;
  /** The readable key the fingerprint hashes, e.g. `orphan:https://a.test/x`. */
  key: string;
  state: DetectionState;
  /** Set exactly when `state` is `indeterminate`. */
  reason: IndeterminateReason | null;
  page_gone: { status_code: 404 | 410 } | null;
  /** The number the verdict was decided on (see each detector); null when there is none. */
  measured: number | null;
  /** The problems proved, sorted; `record` in scope.ts refuses any unless the state is `detected`. */
  conditions: Condition[];
  /** The pages the finding is about, sorted. */
  affected_urls: string[];
  evidence: {
    /** Crawled pages whose results support the verdict, sorted. */
    pages: string[];
    /** Link edges that support the verdict, sorted by from, then to. */
    edges: { from_url: string; to_url: string }[];
  };
}
