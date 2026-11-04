/**
 * The content checks against the labels on real pages (fixtures/v2/content/labels.json). A check
 * fires when it judges a page `fail`; precision is the share of its firings the label also judges
 * `fail`. Pass accuracy is the share of the pages it judges `pass` that the label also judges `pass`.
 * Pages labelled `unsure`, and pages not labelled for the check, are left out.
 *
 * `tallies()` counts the labels as they stand; `tallies(true)` counts them as first read, before the
 * corrections the label set records, so both can be shown. `variantTallies()` counts two rules that
 * were measured on the set and not kept, so the choice between them can be shown.
 */
import type { ContentCheck } from '@crawlmouse/types/v2';
import labels from '../../../fixtures/v2/content/labels.json' with { type: 'json' };
import { CONTENT_CHECKS, judgePage, type PageVerdict } from './checks.js';
import type { ContentFeatures } from './read.js';

/** A counted check must be right on at least this share of its firings and of its passes. */
export const MIN_PRECISION = 0.95;
export const MIN_PASS_ACCURACY = 0.95;

export interface Tally {
  /** Pages labelled for the check, `unsure` left out. */
  labelled: number;
  /** Of those, pages labelled `pass` or `fail`: the check applies. */
  applies: number;
  /** Pages labelled `fail`. */
  failing: number;
  /** Pages the check judged `fail`. */
  fires: number;
  /** Of those, pages also labelled `fail`. */
  confirmed: number;
  /** Pages the check judged `pass`. */
  passes: number;
  /** Of those, pages also labelled `pass`. */
  passes_confirmed: number;
}

type Page = (typeof labels.pages)[number];
type Judge = (f: ContentFeatures) => Record<ContentCheck, PageVerdict>;

function labelOf(page: Page, check: ContentCheck, first: boolean): string | undefined {
  const c = first ? page.corrections.find((x) => x.check === check) : undefined;
  return c ? c.from.label : (page.labels as Record<string, { label: string }>)[check]?.label;
}

type LabelFor = (page: Page, check: ContentCheck) => string | undefined;

function tally(judge: Judge, labelFor: LabelFor): Record<ContentCheck, Tally> {
  const out = {} as Record<ContentCheck, Tally>;
  for (const page of labels.pages) {
    const verdicts = judge(page.features as ContentFeatures);
    for (const check of Object.keys(CONTENT_CHECKS) as ContentCheck[]) {
      const label = labelFor(page, check);
      if (label === undefined || label === 'unsure') continue;
      const t = (out[check] ??= {
        labelled: 0,
        applies: 0,
        failing: 0,
        fires: 0,
        confirmed: 0,
        passes: 0,
        passes_confirmed: 0,
      });
      t.labelled += 1;
      if (label === 'pass' || label === 'fail') t.applies += 1;
      if (label === 'fail') t.failing += 1;
      if (verdicts[check] === 'fail') {
        t.fires += 1;
        if (label === 'fail') t.confirmed += 1;
      }
      if (verdicts[check] === 'pass') {
        t.passes += 1;
        if (label === 'pass') t.passes_confirmed += 1;
      }
    }
  }
  return out;
}

export const tallies = (first = false): Record<ContentCheck, Tally> =>
  tally(judgePage, (p, c) => labelOf(p, c, first));

/**
 * The rulings the labels leave open, each with the label it would give the pages that turn on it.
 * Pages are labelled `unsure` until the owner rules; these count them as each ruling would.
 */
export const RULINGS = {
  cta_is_content: {
    cause: 'criteria_silent_on_cta',
    check: 'question_headings',
    ruling: 'a call-to-action question is a content heading',
    label: 'pass',
  },
  cta_is_not: {
    cause: 'criteria_silent_on_cta',
    check: 'question_headings',
    ruling: 'a call-to-action question is not a content heading',
    label: 'fail',
  },
} as const satisfies Record<
  string,
  { cause: string; check: ContentCheck; ruling: string; label: string }
>;

export type Ruling = keyof typeof RULINGS;

/** Each ruling's tally of the check it decides, on the labels as they stand otherwise. */
export function rulingTallies(): Record<Ruling, Tally> {
  const out = {} as Record<Ruling, Tally>;
  for (const name of Object.keys(RULINGS) as Ruling[]) {
    const r = RULINGS[name];
    out[name] = tally(judgePage, (p, c) =>
      c === r.check && p.corrections.some((x) => x.check === c && x.cause === r.cause)
        ? r.label
        : labelOf(p, c, false),
    )[r.check];
  }
  return out;
}

/** The rules measured on the set and not kept, each with the check it would change. */
export const VARIANTS = {
  section_questions: {
    check: 'question_headings',
    rule: 'a question counts only among the section headings',
    judge: (f: ContentFeatures) =>
      judgePage({ ...f, headings: { ...f.headings, questions: f.headings.section_questions } }),
  },
  schema_on_shell: {
    check: 'schema_with_description',
    rule: 'a client-rendered page is judged on its JSON-LD',
    judge: (f: ContentFeatures) => ({
      ...judgePage(f),
      schema_with_description: CONTENT_CHECKS.schema_with_description.judge(f),
    }),
  },
} as const satisfies Record<string, { check: ContentCheck; rule: string; judge: Judge }>;

export type Variant = keyof typeof VARIANTS;

/** Each variant's tally of the check it changes, on the labels as they stand. */
export function variantTallies(): Record<Variant, Tally> {
  const out = {} as Record<Variant, Tally>;
  for (const name of Object.keys(VARIANTS) as Variant[]) {
    const v = VARIANTS[name];
    out[name] = tally(v.judge, (p, c) => labelOf(p, c, false))[v.check];
  }
  return out;
}

/** Whether a tally clears the bar for counting in Quotable: the check fires and passes, right enough. */
export function validated(t: Tally): boolean {
  return (
    t.fires > 0 &&
    t.passes > 0 &&
    t.confirmed >= MIN_PRECISION * t.fires &&
    t.passes_confirmed >= MIN_PASS_ACCURACY * t.passes
  );
}

/** P(X ≥ x) for X ~ Binomial(n, p), 0 < p < 1. */
function binomialTail(x: number, n: number, p: number): number {
  let sum = 0;
  let term = (1 - p) ** n;
  for (let k = 0; k <= n; k++) {
    if (k >= x) sum += term;
    term = (term * (n - k) * p) / ((k + 1) * (1 - p));
  }
  return sum;
}

/**
 * The exact (Clopper-Pearson) one-sided 95 % lower bound on a rate seen as `x` of `n`: the rate at
 * which `x` or more of `n` has a 5 % chance. 0 when `x` is 0; null when `n` is 0.
 */
export function lowerBound(x: number, n: number): number | null {
  if (n === 0) return null;
  if (x === 0) return 0;
  if (x === n) return 0.05 ** (1 / n);
  let lo = 0;
  let hi = x / n;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (binomialTail(x, n, mid) < 0.05) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
