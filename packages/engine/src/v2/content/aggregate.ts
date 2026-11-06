/**
 * The content checks over a check's graded pages: each page's failures, the summary the Content
 * section shows, the Quotable input, and one record per template for each check that has a fix type.
 *
 * A template's record is decided on its pages the check was decided on (pass or fail):
 *   detected      at least TEMPLATE_RULE.DETECT_MIN_PAGES failing, and failing ≥ DETECT_SHARE of them
 *   not_detected  failing ≤ CLEAR_SHARE of them
 *   indeterminate otherwise (`hysteresis_band`; `too_few_pages` when the share is reached on fewer
 *                 pages), or when a page of the template was not read (`pages_not_read`)
 * A template where the check was decided on no page and no page was unread has no record.
 */
import type {
  Check,
  ContentCheck,
  DetectionState,
  RecommendationClass,
} from '@crawlmouse/types/v2';
import { fingerprintOf } from '../detectors/fingerprint.js';
import { byText, sorted } from '../detectors/scope.js';
import type { QuotableInput } from '../grade/quotable.js';
import { CONTENT_CHECKS, judgePage, type CheckDefinition, type PageVerdict } from './checks.js';
import type { ContentFeatures } from './read.js';
import { TEMPLATE_RULE } from './thresholds.js';

export interface ContentPage {
  url: string;
  template_key: string;
  /** What readPage read of the page; null when its HTML was not read. */
  features: ContentFeatures | null;
}

/** Not read for content: its HTML was not read, or it is served for JavaScript to fill in. */
const unreadPage = (p: ContentPage) => p.features === null || p.features.client_rendered;
const UNREAD = Object.fromEntries(
  (Object.keys(CONTENT_CHECKS) as ContentCheck[]).map((c) => [c, 'unread']),
) as Record<ContentCheck, PageVerdict>;

export type ContentFixType = NonNullable<CheckDefinition['fix']>;

export const CONTENT_INDETERMINATE_REASONS = [
  'pages_not_read',
  'too_few_pages',
  'hysteresis_band',
] as const;
export type ContentIndeterminateReason = (typeof CONTENT_INDETERMINATE_REASONS)[number];

/** One content fix type's verdict on one template. */
export interface ContentDetection {
  type: ContentFixType;
  check: ContentCheck;
  /** `FingerprintSchema`: the hash of `key`. */
  fingerprint: string;
  /** The readable key, e.g. `answer:/blog/{slug}`. */
  key: string;
  template_key: string;
  state: DetectionState;
  /** Set exactly when `state` is `indeterminate`. */
  reason: ContentIndeterminateReason | null;
  /** The share of the decided pages that fail; null when none was decided. */
  measured: number | null;
  extent: { failing: number; of: number; unread: number };
  recommendation_class: RecommendationClass;
  /** The failing pages, sorted: empty unless detected. */
  affected_urls: string[];
}

export interface ContentResult {
  /** Each graded page's verdicts, by URL. */
  verdicts: Map<string, Record<ContentCheck, PageVerdict>>;
  /** Each graded page's failed checks, in the contract's order; null when the page was not read. */
  content_failures: Map<string, ContentCheck[] | null>;
  quotable: QuotableInput;
  /** Templates each check was decided on, with passing and decided pages. */
  by_template: NonNullable<Check['content']>['checks'];
  detections: ContentDetection[];
}

const CHECKS = Object.keys(CONTENT_CHECKS) as ContentCheck[];

function decide(
  fail: number,
  of: number,
  unread: number,
): Pick<ContentDetection, 'state' | 'reason'> {
  if (unread > 0) return { state: 'indeterminate', reason: 'pages_not_read' };
  const share = fail / of;
  if (share <= TEMPLATE_RULE.CLEAR_SHARE) return { state: 'not_detected', reason: null };
  if (share < TEMPLATE_RULE.DETECT_SHARE)
    return { state: 'indeterminate', reason: 'hysteresis_band' };
  if (fail < TEMPLATE_RULE.DETECT_MIN_PAGES)
    return { state: 'indeterminate', reason: 'too_few_pages' };
  return { state: 'detected', reason: null };
}

export function aggregateContent(pages: readonly ContentPage[]): ContentResult {
  const verdicts = new Map(
    pages.map((p) => [p.url, p.features === null ? UNREAD : judgePage(p.features)] as const),
  );
  const content_failures = new Map(
    pages.map((p) => {
      const v = verdicts.get(p.url)!;
      return [p.url, unreadPage(p) ? null : CHECKS.filter((c) => v[c] === 'fail')] as const;
    }),
  );
  const templates = [...new Set(pages.map((p) => p.template_key))].sort(byText);
  const of = (check: ContentCheck, template: string | null, verdict: PageVerdict) =>
    pages.filter(
      (p) =>
        (template === null || p.template_key === template) &&
        verdicts.get(p.url)![check] === verdict,
    );

  const quotable: QuotableInput = {
    checks: Object.fromEntries(
      CHECKS.filter((c) => CONTENT_CHECKS[c].scored).map((c) => {
        const passing = of(c, null, 'pass').length;
        return [
          c,
          {
            passing,
            decided: passing + of(c, null, 'fail').length,
            unread: of(c, null, 'unread').length,
          },
        ];
      }),
    ),
  };

  const by_template = CHECKS.map((check) => ({
    check,
    counted: CONTENT_CHECKS[check].scored,
    by_template: templates.flatMap((template_key) => {
      const passing = of(check, template_key, 'pass').length;
      const total = passing + of(check, template_key, 'fail').length;
      return total === 0 ? [] : [{ template_key, passing, total }];
    }),
  }));

  const detections: ContentDetection[] = [];
  for (const check of CHECKS) {
    const def = CONTENT_CHECKS[check];
    if (def.fix === null || def.key === null) continue;
    for (const template_key of templates) {
      const failing = of(check, template_key, 'fail');
      const decided = failing.length + of(check, template_key, 'pass').length;
      const unread = of(check, template_key, 'unread').length;
      if (decided === 0 && unread === 0) continue;
      const verdict =
        decided === 0
          ? { state: 'indeterminate' as const, reason: 'pages_not_read' as const }
          : decide(failing.length, decided, unread);
      const key = `${def.key}:${template_key}`;
      detections.push({
        type: def.fix,
        check,
        fingerprint: fingerprintOf(key),
        key,
        template_key,
        ...verdict,
        measured: decided === 0 ? null : failing.length / decided,
        extent: { failing: failing.length, of: decided, unread },
        recommendation_class: def.recommendation_class,
        affected_urls: verdict.state === 'detected' ? sorted(failing.map((p) => p.url)) : [],
      });
    }
  }
  return { verdicts, content_failures, quotable, by_template, detections };
}
