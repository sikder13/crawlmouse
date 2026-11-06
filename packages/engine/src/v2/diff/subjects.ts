/**
 * What each fix type is about, for the Changes page and the coverage rule.
 */
import type { Change, FixSection, FixType } from '@crawlmouse/types/v2';

type ChangeSubject = Change['subject'];

/** The audit section each fix type belongs to, as the CC-11 fixtures record it. */
export const FIX_SECTION: Readonly<Record<FixType, FixSection>> = {
  robots_txt_blocks_crawler: 'crawler_access',
  edge_rule_blocks_crawler: 'crawler_access',
  client_rendered_template: 'without_js',
  orphan_pages: 'structure',
  quotable_opening: 'content',
  generic_anchor_text: 'structure',
  deep_pages: 'structure',
  specs_as_images: 'content',
  missing_schema_description: 'content',
  no_question_headings: 'content',
  missing_author_date: 'content',
  js_only_navigation: 'structure',
  redirect_chain: 'structure',
  duplicate_pagination: 'structure',
  canonical_mismatch: 'structure',
  hreflang_gap: 'structure',
};

const SECTION_SUBJECT: Readonly<Record<FixSection, ChangeSubject>> = {
  crawler_access: 'crawler_access',
  without_js: 'text_without_js',
  structure: 'structure',
  content: 'content',
};

/** Where a fix type has a subject of its own, narrower than its section's. */
const OWN_SUBJECT: Readonly<Partial<Record<FixType, ChangeSubject>>> = {
  orphan_pages: 'orphans',
};

/** The subject of a change row a fix writes: its own, or else its section's. */
export const FIX_SUBJECT: Readonly<Record<FixType, ChangeSubject>> = Object.fromEntries(
  (Object.keys(FIX_SECTION) as FixType[]).map((type) => [
    type,
    OWN_SUBJECT[type] ?? SECTION_SUBJECT[FIX_SECTION[type]],
  ]),
) as Record<FixType, ChangeSubject>;

/**
 * What a fix type's measurement depends on, beyond the site itself: the pages the crawl reached
 * (`page_cap`), the pages tested as each AI crawler (`sample`), or neither (`null`: robots.txt is
 * read whole). When that changed between two checks, a fix of the type is not resolved and writes no
 * row (diff.ts). Provisional: chosen from what each detector reads, until the detectors (CC-15/16/17)
 * state it themselves.
 */
export type CoverageDependence = 'page_cap' | 'sample' | null;

export const COVERAGE_DEPENDENCE: Readonly<Record<FixType, CoverageDependence>> = {
  robots_txt_blocks_crawler: null,
  edge_rule_blocks_crawler: 'sample',
  client_rendered_template: 'sample',
  orphan_pages: 'page_cap',
  quotable_opening: 'page_cap',
  generic_anchor_text: 'page_cap',
  deep_pages: 'page_cap',
  specs_as_images: 'page_cap',
  missing_schema_description: 'page_cap',
  no_question_headings: 'page_cap',
  missing_author_date: 'page_cap',
  js_only_navigation: 'page_cap',
  redirect_chain: 'page_cap',
  duplicate_pagination: 'page_cap',
  canonical_mismatch: 'page_cap',
  hreflang_gap: 'page_cap',
};
