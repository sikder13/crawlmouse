/**
 * The five quotable checks (FACTS B9), each judging one page: `pass`, `fail`, `not_applicable`, or
 * `unread` when the page was served for JavaScript to fill in and what decides the check was not read
 * (rendered text comes with CC-14). A check fails a page only on what it reads there: for
 * direct_answer_150 that means few failures and passes it cannot tell from a failure (labels.test.ts).
 */
import type { Confidence, ContentCheck, FixType, RecommendationClass } from '@crawlmouse/types/v2';
import type { ContentFeatures, JsonLdNode } from './read.js';
import {
  MIN_BLOCK_WORDS,
  MIN_BODY_WORDS,
  MIN_HEADINGS,
  MIN_SPEC_LINES,
  OPENING_WORDS,
} from './thresholds.js';

export type PageVerdict = 'pass' | 'fail' | 'not_applicable' | 'unread';

/** The JSON-LD types that describe the page's own subject, not the site or the business behind it. */
const PAGE_SUBJECT =
  /(?:Page|Article|BlogPosting|SocialMediaPosting)$|^(?:Product|ProductModel|IndividualProduct|Service|Event|Recipe|HowTo|Course|TouristTrip|Car|Vehicle)$/;
/** The JSON-LD types of an article. */
const ARTICLE =
  /(?:Article|BlogPosting|LiveBlogPosting|SocialMediaPosting|DiscussionForumPosting|Report)$/;
/** The JSON-LD types of a product. */
const PRODUCT = /(?:^Product|ProductModel|IndividualProduct|^Car|^Vehicle)$/;

const typed = (nodes: readonly JsonLdNode[], re: RegExp) =>
  nodes.filter((n) => n.types.some((t) => re.test(t)));

/** A page of prose: an H1 with MIN_BODY_WORDS words or more after it, and not a product page. */
function isProse(p: ContentFeatures): boolean {
  return p.has_h1 && p.words_after_h1 >= MIN_BODY_WORDS && typed(p.json_ld, PRODUCT).length === 0;
}

/**
 * Within the first OPENING_WORDS words after the H1, a block of prose holds a statement that can be
 * quoted as an answer. List items and blocks under MIN_BLOCK_WORDS words (dates, bylines, calls to
 * action) are page furniture and do not count.
 */
function directAnswer(p: ContentFeatures): PageVerdict {
  if (!isProse(p)) return 'not_applicable';
  let read = 0;
  for (const block of p.opening) {
    if (read >= OPENING_WORDS) break;
    read += block.words;
    if (block.tag === 'li' || block.words < MIN_BLOCK_WORDS) continue;
    if (block.answer_sentences > 0) return 'pass';
  }
  return 'fail';
}

/** A page of prose with MIN_HEADINGS section headings or more has one phrased as a question. */
function questionHeadings(p: ContentFeatures): PageVerdict {
  if (!isProse(p) || p.headings.count < MIN_HEADINGS) return 'not_applicable';
  return p.headings.questions > 0 ? 'pass' : 'fail';
}

function schemaWithDescription(p: ContentFeatures): PageVerdict {
  if (p.json_ld.length === 0) return 'not_applicable';
  return typed(p.json_ld, PAGE_SUBJECT).some((n) => n.has_description) ? 'pass' : 'fail';
}

function authorAndDate(p: ContentFeatures): PageVerdict {
  const articles = typed(p.json_ld, ARTICLE);
  if (articles.length === 0) return 'not_applicable';
  const b = p.byline;
  const author =
    articles.some((n) => n.has_author) || b.meta_author || b.rel_author || b.itemprop_author;
  const date =
    articles.some((n) => n.has_dated_publication) ||
    b.published_time ||
    b.itemprop_date ||
    b.time_datetime;
  return author && date ? 'pass' : 'fail';
}

function specsAsText(p: ContentFeatures): PageVerdict {
  if (typed(p.json_ld, PRODUCT).length === 0) return 'not_applicable';
  const asText = p.specs.structured > 0 || p.specs.label_value_lines >= MIN_SPEC_LINES;
  return p.specs.spec_images > 0 && !asText ? 'fail' : 'pass';
}

export interface CheckDefinition {
  judge: (p: ContentFeatures) => PageVerdict;
  /**
   * The verdict on a page served for JavaScript to fill in, from what is read without rendering
   * (JSON-LD, byline markup): `unread` where the rendered page could decide otherwise.
   */
  onShell: (p: ContentFeatures) => PageVerdict;
  /** The fix a failing template opens; null when the contract has no fix type for the check. */
  fix: Extract<FixType, 'quotable_opening' | 'missing_author_date' | 'specs_as_images'> | null;
  /** The readable key prefix of that fix's fingerprint. */
  key: string | null;
  recommendation_class: RecommendationClass;
  /** How sure a fix the check opens is: `inconclusive` until its firings are observed on real pages. */
  confidence: Confidence;
  /**
   * The check counts in Quotable. labels.test.ts holds each counted check to MIN_PRECISION on the
   * label set, on its firings and on its passes; a check that has not shown both is reported and does
   * not count, so a pass it cannot tell from a failure does not raise the score.
   */
  scored: boolean;
}

const unread = (): PageVerdict => 'unread';
/** Applies only if the JSON-LD says so; beyond that the rendered page decides. */
const shellIf = (type: RegExp) => (p: ContentFeatures) =>
  typed(p.json_ld, type).length === 0 ? 'not_applicable' : 'unread';

/** Each check, in the contract's order. */
export const CONTENT_CHECKS: Readonly<Record<ContentCheck, CheckDefinition>> = {
  direct_answer_150: {
    judge: directAnswer,
    onShell: unread,
    fix: 'quotable_opening',
    key: 'answer',
    recommendation_class: 'experimental',
    confidence: 'inconclusive',
    scored: false,
  },
  question_headings: {
    judge: questionHeadings,
    onShell: unread,
    fix: null,
    key: null,
    recommendation_class: 'experimental',
    confidence: 'likely',
    scored: true,
  },
  schema_with_description: {
    judge: schemaWithDescription,
    onShell: unread,
    fix: null,
    key: null,
    recommendation_class: 'best_practice',
    confidence: 'likely',
    scored: true,
  },
  author_and_date: {
    judge: authorAndDate,
    onShell: (p) =>
      typed(p.json_ld, ARTICLE).length === 0
        ? 'not_applicable'
        : authorAndDate(p) === 'pass'
          ? 'pass'
          : 'unread',
    fix: 'missing_author_date',
    key: 'byline',
    recommendation_class: 'best_practice',
    confidence: 'likely',
    scored: true,
  },
  specs_as_text: {
    judge: specsAsText,
    onShell: shellIf(PRODUCT),
    fix: 'specs_as_images',
    key: 'spec',
    recommendation_class: 'best_practice',
    confidence: 'inconclusive',
    scored: false,
  },
};

export function judgePage(p: ContentFeatures): Record<ContentCheck, PageVerdict> {
  const out = {} as Record<ContentCheck, PageVerdict>;
  for (const [check, def] of Object.entries(CONTENT_CHECKS) as [ContentCheck, CheckDefinition][]) {
    out[check] = p.client_rendered ? def.onShell(p) : def.judge(p);
  }
  return out;
}
