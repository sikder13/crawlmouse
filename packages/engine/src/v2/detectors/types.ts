/**
 * What the structure detectors read and what they report.
 *
 * The contract's records (`PageResult`, `LinkEdge`, `Check`) carry most of a check. `PageFacts` holds
 * what one request showed that the contract does not store yet (redirect hops, the declared canonical,
 * the content hash, hreflang). Each of those facts is nullable, and null means "not read": a detector
 * that needs a null fact reports `indeterminate` rather than assuming a value.
 *
 * URLs are expected in the engine's canonical spelling (`canonicalizeUrl`), the spelling the
 * contract's `LinkEdge` uses; the detectors compare those as strings. The URLs inside PageFacts are
 * canonicalised in scope.ts, because the worker stores where a request ended as the server wrote it.
 * `PageResult.url` is the URL that was requested, which is what links point at, and its status is
 * the final response's; where the request ended is `PageFacts.final_url`. The worker records a
 * redirected page's links from where it landed, so scope.ts files them back under the requested URL.
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
  /**
   * The page's HTML was parsed and its links read; null when not recorded. Needed only for a 200 page
   * that recorded no links: the worker writes no count when it fetched a page and did not read it.
   */
  links_read: boolean | null;
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
  /** The previous graded check's coverage, for comparing samples; null when there is none. */
  previous_coverage: Coverage | null;
}

/** Why a detector could not decide. */
export const INDETERMINATE_REASONS = [
  'crawl_truncated',
  'urls_not_fetched',
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
  'list_page_gone',
  'page_not_read',
  'canonical_not_read',
  'canonical_target_not_fetched',
  'canonical_target_not_read',
  'member_not_crawled',
] as const;
export type IndeterminateReason = (typeof INDETERMINATE_REASONS)[number];

/** A specific problem a detector proved, for the fix types that have more than one kind. */
export const CONDITIONS = [
  'redirect_loop',
  'pagination_near_duplicate',
  'pagination_canonical_to_first',
  'canonical_cross_host',
  'canonical_target_redirects',
  'canonical_target_gone',
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
  /** The measured value for the subject, defined per fix type in the spec; null when none. */
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
