/**
 * What heads a fix where a view gives its effect: the Result's first-fix card and fixes table, the
 * segment's open fix, and the fix page ask here (owner ruling, 2026-11-05). The segment's Pro rows
 * do not: they give a fix's Technical SEO points beside what its AI effect waits on, as the locked
 * Final-Seg-Content does.
 *
 * - An AI readability effect that is estimated and not 0 heads the fix with its points.
 * - A fix in crawler_access, without_js or content moves AI readability. While its AI effect is null
 *   it is headed by why it waits, from the first entry of `ai_readability_pending_on`: no Technical
 *   SEO figure and no "+0".
 * - A structure fix whose AI effect is null keeps its Technical SEO points, and waits when they are 0.
 * - Otherwise the fix is headed by its Technical SEO points, or says they are not estimated.
 */
import {
  WithheldReasonSchema,
  type Fix,
  type FixSection,
  type WithheldReason,
} from '@crawlmouse/types/v2';
import { listOf } from '../format';
import { plural } from '../words';

export type EffectHeadline =
  | { kind: 'ai'; points: number }
  | { kind: 'seo'; points: number }
  | { kind: 'seo_not_estimated' }
  /** `sentence` heads the card, the open fix and the fix page; `short` the table. */
  | { kind: 'waiting'; sentence: string; short: string };

/** The sections whose fixes move AI readability. */
export const AI_SECTIONS: ReadonlySet<FixSection> = new Set([
  'crawler_access',
  'without_js',
  'content',
]);

/**
 * Why an AI effect waits, as a reader is told it, one sentence per reason the engine gives
 * (packages/engine/src/v2/grade/withheld.ts says what each means). The first five withhold the
 * grade; the last two are a fix's own.
 */
export const AI_WAITING: Readonly<Record<WithheldReason, string>> = {
  too_few_crawlers_measured: 'AI readability is graded once two scored crawlers can be measured',
  blocked_by_choice:
    'AI readability is not graded while the site’s robots.txt keeps the scored crawlers out',
  readable_unmeasured: 'AI readability is graded once each template has a page read in a browser',
  quotable_unmeasured: 'AI readability is graded once its content part can be measured',
  signals_unmeasured:
    'AI readability is graded once its schema.org and Content Signals checks are decided',
  crawler_too_few_pages: 'AI effect estimated once its crawler has two pages that decide its share',
  check_not_scored: 'AI effect estimated once its content check counts toward the grade',
};

const NOT_YET = 'AI not yet estimated';
const REASONS: readonly string[] = WithheldReasonSchema.options;
const isReason = (p: string): p is WithheldReason => REASONS.includes(p);

type Numbered = Pick<Fix, 'fingerprint' | 'number'>;

/**
 * Why `f`'s AI effect waits, from its first pending entry. A fingerprint names another fix of the
 * site; the fixes its fingerprints name are listed by number. A fingerprint naming no fix in
 * `siteFixes` is skipped, and the first reason listed is used instead.
 */
function waiting(
  f: Pick<Fix, 'effect'>,
  siteFixes: readonly Numbered[],
): Extract<EffectHeadline, { kind: 'waiting' }> {
  const pending = f.effect.ai_readability_pending_on;
  const first = pending[0];
  if (first !== undefined && !isReason(first)) {
    const numbers = [
      ...new Set(
        pending
          .filter((p) => !isReason(p))
          .map((fp) => siteFixes.find((x) => x.fingerprint === fp)?.number)
          .filter((n): n is number => n !== undefined),
      ),
    ];
    if (numbers.length) {
      const after = `${plural(numbers.length, 'fix', 'fixes')} ${listOf(numbers.map(String))}`;
      return {
        kind: 'waiting',
        sentence: `AI effect estimated after ${after}`,
        short: `AI after ${after}`,
      };
    }
  }
  const reason = pending.find(isReason);
  return {
    kind: 'waiting',
    sentence: reason ? AI_WAITING[reason] : 'AI effect not yet estimated',
    short: NOT_YET,
  };
}

export function effectHeadline(
  f: Pick<Fix, 'effect' | 'section'>,
  siteFixes: readonly Numbered[],
): EffectHeadline {
  const { ai_readability: ai, technical_seo: seo } = f.effect;
  if (ai) return { kind: 'ai', points: ai };
  if (ai === null && (AI_SECTIONS.has(f.section) || seo === 0)) return waiting(f, siteFixes);
  return seo === null ? { kind: 'seo_not_estimated' } : { kind: 'seo', points: seo };
}
