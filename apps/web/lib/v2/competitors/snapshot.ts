/**
 * Row 18: what of a competitor's ended check is copied into the customer's check. Each figure is
 * read as the Signals screen reads the customer's own (view/segment/signals.ts): the AI crawlers
 * that get in, the share of text without JavaScript, the Technical SEO grade, the AI readability
 * grade and the agent signals present. A figure the competitor's check did not measure is null, and
 * the screen says so; none is guessed.
 *
 * The snapshot holds the competitor's host and its own measurements only: nothing of the customer's
 * account, site or check is in it, and nothing of the customer's is written to the competitor's check.
 */
import type { Check, CompetitorSnapshot } from '@crawlmouse/types/v2';
import { isAi, isAllowed } from '../sentences';
import { screenSignals } from '../view/screen-signals';

/** The snapshot of `check`, an ended check of `host`; null for a check that has not ended. */
export function competitorSnapshot(check: Check, host: string): CompetitorSnapshot | null {
  if (check.status !== 'finished' && check.status !== 'partial') return null;
  const ai = check.crawlers.filter(isAi);
  const seo = check.technical_seo;
  const air = check.ai_readability;
  const signals = screenSignals(check);
  return {
    host,
    crawlers_with_access: ai.filter((c) => isAllowed(c.verdict)).length,
    crawlers_tested: ai.length,
    text_share: check.without_js?.site_text_share ?? null,
    // A check stores no JSON-LD types, so whether the competitor marks up products is not known.
    product_schema: null,
    technical_seo:
      seo && seo.score !== null && seo.grade !== null
        ? { score: seo.score, grade: seo.grade }
        : null,
    ai_readability: air && !air.withheld ? { score: air.total, grade: air.grade } : null,
    // Null when no signal could be read, rather than a count of none found.
    signals_present: signals.every((s) => s.state === 'indeterminate')
      ? null
      : signals.filter((s) => s.state === 'detected').length,
  };
}
