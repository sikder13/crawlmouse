/**
 * A built check's status, from its batches' partial reasons: `partial` when any batch did less than
 * it was asked in a way that leaves a measurement incomplete, else `finished`. Each reason is decided
 * here, and the spec renders this table.
 *
 * `crawl` says whether the reason, on a crawl batch, means the crawl itself was cut short. The
 * structure detectors read the check's status as "the crawl was cut short" (detectors/scope.ts
 * isTruncated), so they are told `partial` only for a crawl that was: an access batch's spent budget
 * leaves crawler tests unrun, which makes the check partial, but every page was still crawled.
 */
import type { BatchPartialReason, CheckStatus } from '@crawlmouse/types/v2';
import type { Batches } from './batches.js';

export const PARTIAL_RULE: Readonly<
  Record<BatchPartialReason, { partial: boolean; crawl: boolean; why: string }>
> = {
  budget_requests: {
    partial: true,
    crawl: true,
    why: 'the request budget ran out before every URL was fetched',
  },
  budget_bytes: {
    partial: true,
    crawl: true,
    why: 'the byte budget ran out before every URL was fetched',
  },
  budget_seconds: {
    partial: true,
    crawl: true,
    why: 'the time budget ran out before every URL was fetched',
  },
  site_stopped: {
    partial: true,
    crawl: true,
    why: 'the site was stopped (429s or challenges) and later URLs were not fetched',
  },
  robots_unreachable: {
    partial: true,
    crawl: true,
    why: "robots.txt could not be read, so the origin's URLs were not fetched",
  },
  robots_too_large: {
    partial: true,
    crawl: true,
    why: "robots.txt was too large to evaluate, so the origin's URLs were not fetched",
  },
  site_refused: {
    partial: true,
    crawl: true,
    why: "the address was refused (SSRF guard), so the origin's URLs were not fetched",
  },
  crawl_delay_over_limit: {
    partial: true,
    crawl: true,
    why: 'the Crawl-delay is over what the worker honours, so the batch fetched nothing',
  },
  crawl_delay_10s_or_more: {
    partial: false,
    crawl: false,
    why: 'the Crawl-delay was honoured in full: the delay alone does not cut the crawl',
  },
  result_size: {
    partial: true,
    crawl: true,
    why: "pages past the batch's 8 MiB kept no text, links or features, so their links are unknown",
  },
};

export interface StatusDecision {
  status: Extract<CheckStatus, 'finished' | 'partial'>;
  /** The reasons that made it partial, each once, sorted. */
  reasons: BatchPartialReason[];
  /** A crawl batch's reason cut the crawl short, or the crawl was not run to its end. */
  crawl_partial: boolean;
  /**
   * What the check did not finish that no batch reason states: `crawl` when the crawl planner still has
   * URLs to fetch, `sample` when a page the sample planned has no crawler test. Either makes it partial.
   */
  unfinished: Unfinished[];
}

export type Unfinished = 'crawl' | 'sample';

export function decideStatus(
  batches: Batches,
  unfinished: readonly Unfinished[] = [],
): StatusDecision {
  const counted = (reasons: readonly BatchPartialReason[]) =>
    reasons.filter((r) => PARTIAL_RULE[r].partial);
  const all = [...batches.crawl, ...batches.access].flatMap((b) =>
    counted(b.partial?.reasons ?? []),
  );
  const reasons = [...new Set(all)].sort();
  const crawl_partial =
    unfinished.includes('crawl') ||
    batches.crawl.some((b) => (b.partial?.reasons ?? []).some((r) => PARTIAL_RULE[r].crawl));
  return {
    status: reasons.length > 0 || unfinished.length > 0 ? 'partial' : 'finished',
    reasons,
    crawl_partial,
    unfinished: [...new Set(unfinished)].sort(),
  };
}
