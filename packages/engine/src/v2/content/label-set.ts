/**
 * The content checks against a person's labels on real pages (fixtures/v2/content/labels.json). A
 * check fires when it judges a page `fail`; precision is the share of its firings the person also
 * judged `fail`. Pages the person marked `unsure` are left out.
 */
import type { ContentCheck } from '@crawlmouse/types/v2';
import labels from '../../../fixtures/v2/content/labels.json' with { type: 'json' };
import { judgePage } from './checks.js';
import type { ContentFeatures } from './read.js';

/** Every check that fires on the label set must be right on at least this share of its firings. */
export const MIN_PRECISION = 0.95;

export interface Tally {
  /** Pages the person judged the check on (not `unsure`). */
  labelled: number;
  /** Pages the person judged `fail`. */
  failing: number;
  /** Pages the check judged `fail`. */
  fires: number;
  /** Of those, pages the person also judged `fail`. */
  confirmed: number;
}

export function tallies(): Record<ContentCheck, Tally> {
  const out = {} as Record<ContentCheck, Tally>;
  for (const page of labels.pages) {
    const verdicts = judgePage(page.features as ContentFeatures);
    for (const [check, { label }] of Object.entries(page.labels)) {
      if (label === 'unsure') continue;
      const t = (out[check as ContentCheck] ??= {
        labelled: 0,
        failing: 0,
        fires: 0,
        confirmed: 0,
      });
      t.labelled += 1;
      if (label === 'fail') t.failing += 1;
      if (verdicts[check as ContentCheck] === 'fail') {
        t.fires += 1;
        if (label === 'fail') t.confirmed += 1;
      }
    }
  }
  return out;
}
