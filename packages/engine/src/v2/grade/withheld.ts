/**
 * Why the engine gives no AI readability grade, or no AI effect for a fix, and what the reasons mean.
 * The spec renders this table; contract-pins.test.ts checks that it names exactly the contract's
 * WithheldReason values.
 */
import type { WithheldReason } from '@crawlmouse/types/v2';

export const WITHHELD_REASON_MEANINGS: Readonly<Record<WithheldReason, string>> = {
  too_few_crawlers_measured:
    'Fewer than two scored crawlers have enough measured pages to give Access a score.',
  blocked_by_choice:
    "robots.txt disallows the scored crawlers on the pages whose rules were read: the site's stated choice, so Access is not scored.",
  readable_unmeasured:
    'A template of the graded pages has no page rendered in a browser, so the share of text served without JavaScript is not known.',
  quotable_unmeasured:
    'Some graded pages could not be read for the content checks, or no content check applied to any page.',
  signals_unmeasured:
    'Whether schema.org markup or Content Signals are present could not be decided.',
  crawler_too_few_pages:
    "For a fix's effect only: the fix's crawler has fewer than two pages that decide its share, so how much Access it adds is not known.",
};
