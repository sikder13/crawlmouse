/**
 * Whether a check measured a section of the result, and so what "no fix here" means. No fix on a
 * section that was not measured is not good news: a check that read nothing has no fix. Each place
 * that words an empty section takes its words from `noFixWords`.
 */
import type { Check, FixSection } from '@crawlmouse/types/v2';
import { isAi } from '../sentences';

export function sectionMeasured(check: Check, section: FixSection): boolean {
  switch (section) {
    case 'crawler_access': {
      const ai = check.crawlers.filter(isAi);
      return (
        ai.length > 0 &&
        ai.every((c) => c.verdict !== 'not_measured' && c.verdict !== 'edge_blocks_automation')
      );
    }
    case 'without_js':
      return check.without_js !== null;
    case 'structure':
      return (check.technical_seo?.site_structure_score ?? null) !== null;
    case 'content':
      // The builder stores a withheld content score as a record whose score is null.
      return (check.content?.score ?? null) !== null;
  }
}

export const noFixWords = (check: Check, section: FixSection) =>
  sectionMeasured(check, section) ? 'nothing to fix' : 'not measured';
