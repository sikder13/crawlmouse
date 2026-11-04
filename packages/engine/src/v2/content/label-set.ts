/**
 * The content checks against the labels on real pages (fixtures/v2/content/labels.json). A check
 * fires when it judges a page `fail`; precision is the share of its firings the label also judges
 * `fail`. Pass accuracy is the share of the pages it judges `pass` that the label also judges `pass`.
 * Pages labelled `unsure` are left out.
 *
 * `tallies()` counts the labels as they stand; `tallies(true)` counts them as first read, before the
 * corrections the label set records, so both can be shown.
 */
import type { ContentCheck } from '@crawlmouse/types/v2';
import labels from '../../../fixtures/v2/content/labels.json' with { type: 'json' };
import { judgePage } from './checks.js';
import type { ContentFeatures } from './read.js';

/** A counted check must be right on at least this share of its firings and of its passes. */
export const MIN_PRECISION = 0.95;
export const MIN_PASS_ACCURACY = 0.95;

export interface Tally {
  /** Pages labelled for the check (not `unsure`). */
  labelled: number;
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

function labelOf(page: Page, check: ContentCheck, first: boolean): string {
  const c = first ? page.corrections.find((x) => x.check === check) : undefined;
  return c ? c.from.label : (page.labels as Record<string, { label: string }>)[check]!.label;
}

export function tallies(first = false): Record<ContentCheck, Tally> {
  const out = {} as Record<ContentCheck, Tally>;
  for (const page of labels.pages) {
    const verdicts = judgePage(page.features as ContentFeatures);
    for (const check of Object.keys(page.labels) as ContentCheck[]) {
      const label = labelOf(page, check, first);
      if (label === 'unsure') continue;
      const t = (out[check] ??= {
        labelled: 0,
        failing: 0,
        fires: 0,
        confirmed: 0,
        passes: 0,
        passes_confirmed: 0,
      });
      t.labelled += 1;
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

/** Whether a tally clears the bar for counting in Quotable: the check fires and passes, right enough. */
export function validated(t: Tally): boolean {
  return (
    t.fires > 0 &&
    t.passes > 0 &&
    t.confirmed >= MIN_PRECISION * t.fires &&
    t.passes_confirmed >= MIN_PASS_ACCURACY * t.passes
  );
}
