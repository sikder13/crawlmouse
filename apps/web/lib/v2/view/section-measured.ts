/**
 * Whether a check measured a section of the result, decided from what it read and not from whether a
 * score was given: the engine withholds scores for reasons unrelated to reading (a content score on
 * every current build, a structure score on a small site). No fix on a section that read nothing is
 * not good news. The result, segment and link-map views take their words for an empty section from
 * `noFixWords`.
 */
import type { Check, FixSection } from '@crawlmouse/types/v2';

export function sectionMeasured(check: Check, section: FixSection): boolean {
  switch (section) {
    case 'crawler_access': {
      const ai = check.crawlers.filter((c) => c.group !== 'search_engine');
      return (
        ai.length > 0 &&
        ai.every((c) => c.verdict !== 'not_measured' && c.verdict !== 'edge_blocks_automation')
      );
    }
    case 'without_js':
      return check.without_js !== null;
    case 'structure':
      // A graph with no link has no orphans, so its zero says nothing about the site.
      return (check.structure?.internal_links ?? 0) > 0;
    case 'content':
      return (check.content?.checks ?? []).some((c) => c.by_template.some((r) => r.total > 0));
  }
}

export const noFixWords = (check: Check, section: FixSection) =>
  sectionMeasured(check, section) ? 'nothing to fix' : 'not measured';
