/**
 * Why the engine gives no AI readability grade, or no AI effect for a fix, and what the reasons mean.
 * The spec renders this table; contract-pins.test.ts checks that it names exactly the contract's
 * WithheldReason values.
 */
import type { TechnicalSeoPending, WithheldReason } from '@crawlmouse/types/v2';

export const WITHHELD_REASON_MEANINGS: Readonly<Record<WithheldReason, string>> = {
  too_few_crawlers_measured:
    'Fewer than two scored crawlers have enough measured pages to give Access a score.',
  blocked_by_choice:
    "robots.txt disallows the scored crawlers on the pages whose rules were read: the site's stated choice, so Access is not scored.",
  readable_unmeasured:
    'A template of the graded pages has no page rendered in a browser, so the share of text served without JavaScript is not known.',
  quotable_unmeasured:
    'No content check counts in Quotable (a check counts once it clears the bar on an independent, held-out label set), or a counted check could not be read on some graded pages, or applied to no page.',
  signals_unmeasured:
    'Whether schema.org markup or Content Signals are present could not be decided.',
  crawler_too_few_pages:
    "For a fix's effect only: the fix's crawler has fewer than two pages that decide its share, so how much Access it adds is not known.",
  check_not_scored:
    "For a fix's effect only: the fix's content check is reported but not counted in Quotable (it has not cleared the bar on an independent, held-out label set), so it adds no points yet.",
};

/** Why a fix's Technical SEO effect is not estimated. contract-pins.test.ts pins this to the contract. */
export const TECHNICAL_SEO_PENDING_MEANINGS: Readonly<Record<TechnicalSeoPending, string>> = {
  grade_refused:
    'The Technical SEO grade is refused (SPEC 5.1a), so there is no score for a fix to move; the effect is estimated once a check grades the site.',
};
