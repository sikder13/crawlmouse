/**
 * What heads a fix where a view gives its effect: the Result's first-fix card and fixes table, the
 * segment's open fix, and the fix page ask here (owner ruling, 2026-11-05). The segment's Pro rows
 * do not: they give a fix's Technical SEO points beside what its AI effect waits on, as the locked
 * Final-Seg-Content does.
 *
 * - An AI readability effect above 0 heads the fix with its points.
 * - A fix in crawler_access, without_js or content moves AI readability. While its AI effect is null
 *   it is headed by why it waits (a client-rendered template fix excepted, below), from the first entry of `ai_readability_pending_on`: no Technical
 *   SEO figure and no "+0".
 * - A structure fix whose AI effect is null keeps its Technical SEO points, and waits when they are 0
 *   or less.
 * - Otherwise the fix is headed by its Technical SEO points, or says they are not estimated.
 * - A client-rendered template fix whose AI effect is not above 0 (estimated at 0 or less, or not
 *   estimated yet) is headed by the pages it makes readable, `pages_readable`: "Makes N pages
 *   readable without JavaScript", N its `affected_pages`, never a grade number and never why its AI
 *   effect waits (owner ruling on CC-32 Q8). For a template of empty-root pages alone,
 *   `affected_pages` is the template's crawled empty-root pages: the pages the check saw, not the ones
 *   it rendered, which the Fix record does not carry. A fix the last check did not detect keeps the
 *   count from when it was detected, so it reads "Made N pages readable without JavaScript when last
 *   detected".
 * - An effect at or below zero is never printed with a sign: `formatPoints` gives it no figure, so a
 *   fix whose estimated effects are all 0 or less is headed `no_effect`, "No measurable effect on the
 *   grade" (CC-32 D4). The engine keeps the number it computed.
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
  /** `signed` is `formatPoints(points)`: "+3". */
  | { kind: 'ai'; points: number; signed: string }
  | { kind: 'seo'; points: number; signed: string }
  | { kind: 'seo_not_estimated' }
  | { kind: 'no_effect' }
  /** `text` is `pagesReadableText(pages)`. */
  | { kind: 'pages_readable'; pages: number; text: string }
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

/** What a view prints for an estimated effect at or below zero: the sentence, and the short form. */
export const NO_EFFECT = 'No measurable effect on the grade';
export const NO_EFFECT_SHORT = 'No measurable effect';

/**
 * One figure of a fix's effect as every view prints it: "+3" above zero; null at or below zero,
 * which a view prints as no measurable effect, never with a minus sign.
 */
export const formatPoints = (n: number): string | null => (n > 0 ? `+${n}` : null);

/**
 * "Makes 3 pages readable without JavaScript", singular for one page; for a count from an earlier
 * detection (`current` false), "Made 3 pages readable without JavaScript when last detected".
 */
export const pagesReadableText = (pages: number, current = true): string => {
  const n = `${pages} ${plural(pages, 'page', 'pages')}`;
  return current
    ? `Makes ${n} readable without JavaScript`
    : `Made ${n} readable without JavaScript when last detected`;
};

type Readable = Pick<Fix, 'type' | 'effect' | 'affected_pages' | 'last_state'>;
type Headed = Readable & Pick<Fix, 'section'>;

/** A client-rendered template fix whose AI effect gives no figure: at 0 or less, or not estimated. */
const makesReadable = (f: Pick<Fix, 'type' | 'effect'>): boolean =>
  f.type === 'client_rendered_template' &&
  (f.effect.ai_readability === null || formatPoints(f.effect.ai_readability) === null);

/**
 * The pages the `pages_readable` fixes among `fixes` make readable, as text: those the last check
 * detected, then those it did not; null when none is one.
 */
export function pagesReadable(fixes: readonly Readable[]): string | null {
  const these = fixes.filter(makesReadable);
  const sum = (current: boolean) =>
    these
      .filter((f) => (f.last_state === 'detected') === current)
      .reduce((n, f) => n + f.affected_pages, 0);
  const parts = [true, false].flatMap((current) => {
    const n = sum(current);
    return these.some((f) => (f.last_state === 'detected') === current)
      ? [pagesReadableText(n, current)]
      : [];
  });
  return parts.length ? parts.join('; ') : null;
}

/** A group's points: each member's taken at 0 when below it, so a negative member lowers no sum. */
export const groupSum = (points: readonly number[]): number =>
  points.reduce((sum, n) => sum + Math.max(0, n), 0);

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

export function effectHeadline(f: Headed, siteFixes: readonly Numbered[]): EffectHeadline {
  const { ai_readability: ai, technical_seo: seo } = f.effect;
  const aiSigned = ai === null ? null : formatPoints(ai);
  if (aiSigned !== null) return { kind: 'ai', points: ai!, signed: aiSigned };
  if (makesReadable(f)) {
    return {
      kind: 'pages_readable',
      pages: f.affected_pages,
      text: pagesReadableText(f.affected_pages, f.last_state === 'detected'),
    };
  }
  if (ai === null && (AI_SECTIONS.has(f.section) || (seo !== null && seo <= 0))) {
    return waiting(f, siteFixes);
  }
  if (seo === null) return { kind: 'seo_not_estimated' };
  const seoSigned = formatPoints(seo);
  return seoSigned === null
    ? { kind: 'no_effect' }
    : { kind: 'seo', points: seo, signed: seoSigned };
}
