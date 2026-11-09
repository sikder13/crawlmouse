/**
 * The diff's input (`DetectorOutcome`, diff/types.ts) from the three detector families' records: the
 * structure detectors (CC-16), the access detectors (CC-15) and the content checks. A detected record
 * that opens a fix carries a draft with its computed effect and rank (effects.ts); a record not
 * detected, or that could not decide, carries its state.
 *
 * A robots.txt disallow is the site's stated intent (`opens_fix: false`): it opens no fix, so a
 * detected robots record has no outcome at all, and no counterfactual in the effects.
 */
import type { Confidence, Effect, FixType, RecommendationClass } from '@crawlmouse/types/v2';
import type { AccessDetection } from '../access/types.js';
import { CONTENT_CHECKS } from '../content/checks.js';
import { FIX_SECTION } from '../diff/subjects.js';
import type { DetectorOutcome, FixDraft } from '../diff/types.js';
import { namesOnePage, templateNoun } from '../build/template-noun.js';
import { subjectOfKey } from '../detectors/fingerprint.js';
import type { Detection } from '../detectors/types.js';
import { effectsOf, type FixRecord } from './effects.js';
import type { Grades } from './index.js';

type StructureType = Detection['type'];

/** How strong the case for a structure fix is: a search engine documents the rule, or it is practice. */
export const STRUCTURE_CLASS: Readonly<Partial<Record<FixType, RecommendationClass>>> = {
  orphan_pages: 'best_practice',
  deep_pages: 'best_practice',
  generic_anchor_text: 'best_practice',
  redirect_chain: 'best_practice',
  duplicate_pagination: 'best_practice',
  canonical_mismatch: 'documented_requirement',
  hreflang_gap: 'documented_requirement',
};

/** The structure detectors read our own crawl, so a finding is likely, not confirmed. */
const CRAWL_CONFIDENCE: Confidence = 'likely';

/** "its" or "their", for the pages a template key names. */
const possessive = (key: string) => (namesOnePage(key) ? 'its' : 'their');

/**
 * A fix's title, from its record: the subject is a page URL, a crawler, or, for the fixes that name a
 * template, its key, which the title names by its noun (`templateNoun`).
 */
export const TITLES: Readonly<Partial<Record<FixType, (subject: string) => string>>> = {
  orphan_pages: (s) => `Link to ${s} from another page`,
  deep_pages: (s) => `Bring ${s} within 3 clicks of the homepage`,
  generic_anchor_text: (s) => `Use descriptive link text on ${s}`,
  redirect_chain: (s) => `Link straight to where ${s} redirects`,
  duplicate_pagination: (k) => `Make the later pages of ${templateNoun(k)} distinct`,
  canonical_mismatch: (s) => `Correct the canonical of ${s}`,
  hreflang_gap: (s) => `Complete the hreflang annotations of ${s}`,
  edge_rule_blocks_crawler: (s) => `Let ${s} through the user-agent rule`,
  quotable_opening: (k) => `Open ${templateNoun(k)} with a direct answer`,
  missing_author_date: (k) => `Show an author and a date on ${templateNoun(k)}`,
  specs_as_images: (k) => `Give the specifications on ${templateNoun(k)} as text`,
  missing_schema_description: (k) =>
    `Describe ${templateNoun(k)} in ${possessive(k)} schema.org markup`,
  no_question_headings: (k) => `Phrase a section heading on ${templateNoun(k)} as a question`,
};

function draft(f: FixRecord, effect: Effect, rank: number, absorbed_by: string | null): FixDraft {
  const base = {
    detail: null,
    effort: null,
    before_after: [],
    packet: null,
    effect,
    rank,
    absorbed_by_fingerprint: absorbed_by,
  };
  if (f.family === 'access') {
    const r = f.record;
    return {
      ...base,
      type: r.type,
      section: FIX_SECTION[r.type],
      title: TITLES[r.type]!(r.crawler),
      recommendation_class: r.recommendation_class,
      confidence: r.confidence,
      affected_pages: r.affected_urls.length,
      template_key: null,
      crawler_uas: [r.crawler],
    };
  }
  if (f.family === 'content') {
    const r = f.record;
    return {
      ...base,
      type: r.type,
      section: FIX_SECTION[r.type],
      title: TITLES[r.type]!(r.template_key),
      recommendation_class: r.recommendation_class,
      // set per check by hand (checks.ts): inconclusive while the check does not count in Quotable
      confidence: CONTENT_CHECKS[r.check].confidence,
      affected_pages: r.affected_urls.length,
      template_key: r.template_key,
      crawler_uas: [],
    };
  }
  const r = f.record;
  const type: StructureType = r.type;
  return {
    ...base,
    type,
    section: FIX_SECTION[type],
    title: TITLES[type]!(subjectOfKey(r.key)),
    recommendation_class: STRUCTURE_CLASS[type]!,
    confidence: CRAWL_CONFIDENCE,
    affected_pages: r.affected_urls.length,
    template_key: type === 'duplicate_pagination' ? subjectOfKey(r.key) : null,
    crawler_uas: [],
  };
}

export interface Outcomes {
  outcomes: DetectorOutcome[];
  /** The projected grades less the current ones, every fix applied: what the effects add up to. */
  overview: Effect;
}

export function detectorOutcomes(
  grades: Grades,
  access: readonly AccessDetection[],
  structure: readonly Detection[],
): Outcomes {
  const records: FixRecord[] = [
    ...structure.map((record) => ({ family: 'structure' as const, record })),
    ...access
      .filter((r) => r.state !== 'detected' || r.opens_fix)
      .map((record) => ({ family: 'access' as const, record })),
    ...grades.content_detections.map((record) => ({ family: 'content' as const, record })),
  ];
  const fixes = records.filter((f) => f.record.state === 'detected');
  const { byFix, overview } = effectsOf(grades.inputs, fixes);
  const outcomes = records.map((f): DetectorOutcome => {
    const { fingerprint, state } = f.record;
    if (state === 'detected') {
      const { effect, rank, absorbed_by } = byFix.get(fingerprint)!;
      return { fingerprint, state, fix: draft(f, effect, rank, absorbed_by) };
    }
    if (state === 'not_detected') return { fingerprint, state };
    return { fingerprint, state, gone: f.family === 'structure' ? f.record.page_gone : null };
  });
  return { outcomes, overview };
}
