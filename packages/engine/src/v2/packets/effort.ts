/**
 * The effort of a fix, from its own shape (CC-30 D7): a rule per fix type, written down as data.
 *
 * The contract has two kinds of effort. `templates` is supported by a record that names one template:
 * one template to change, shipped in one deploy. `minutes` would be a time nobody measured, and no
 * record holds anything to estimate one from, so no rule states it and those fixes carry no effort.
 *
 * `EFFORT_RULES` has a key for each `FixType` (the mapped type), so a fix type with no rule does not
 * compile; the spec renders the table from it. `effortOf` reads the rule of the record's own type,
 * whatever its family.
 */
import type { Fix, FixType } from '@crawlmouse/types/v2';
import type { FixRecord } from '../grade/effects.js';

export interface EffortRule {
  /** What a fix of the type carries. */
  effort: Fix['effort'];
  /** Why, for the spec. */
  rule: string;
}

const ONE_TEMPLATE: EffortRule = {
  effort: { kind: 'templates', templates: 1, deploys: 1 },
  rule: 'The record names one template (its template key: `template_key`, or the subject of its key for a paginated list), so the change is to one template, and a change to one template ships in one deploy.',
};

const ONE_PAGE: EffortRule = {
  effort: null,
  rule: 'An edit to one page or to the links that point at it. The record holds no measure of how long that takes, and a number of minutes would be an estimate nobody measured.',
};

const NO_FIX: EffortRule = {
  effort: null,
  rule: 'The engine opens no fix of this type, so there is no effort to state.',
};

export const EFFORT_RULES: { readonly [T in FixType]: EffortRule } = {
  robots_txt_blocks_crawler: NO_FIX,
  edge_rule_blocks_crawler: {
    effort: null,
    rule: 'One rule at the edge. The record names the crawler and the pages the rule holds on, and nothing about where the rule is kept or how long changing it takes.',
  },
  client_rendered_template: ONE_TEMPLATE,
  orphan_pages: ONE_PAGE,
  quotable_opening: ONE_TEMPLATE,
  generic_anchor_text: ONE_PAGE,
  deep_pages: ONE_PAGE,
  specs_as_images: ONE_TEMPLATE,
  missing_author_date: ONE_TEMPLATE,
  js_only_navigation: NO_FIX,
  redirect_chain: ONE_PAGE,
  duplicate_pagination: ONE_TEMPLATE,
  canonical_mismatch: ONE_PAGE,
  hreflang_gap: ONE_PAGE,
  missing_schema_description: ONE_TEMPLATE,
  no_question_headings: ONE_TEMPLATE,
};

export function effortOf(fix: FixRecord): Fix['effort'] {
  return EFFORT_RULES[fix.record.type].effort;
}
