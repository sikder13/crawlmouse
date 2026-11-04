/**
 * Readable (max 30): the share of a page's words served without JavaScript, page-weighted by template.
 *
 *   ratio(t) = median text_share of t's rendered pages
 *   Readable = 30 × Σ_t pages(t) × ratio(t) / Σ_t pages(t)
 *
 * over the graded pages. A template with no rendered page has no ratio, so Readable is then a range:
 * those templates' pages counted at 0 and at 1. Nothing graded, or nothing rendered, is the range 0
 * to 30. `text_share` is the rendered pass's (CC-14); until it runs every page's is null.
 */
import { median, ranged, scored, type Measure } from './numbers.js';
import { AI_WEIGHTS } from './weights.js';

export interface ReadablePage {
  template_key: string;
  /** Words served without JavaScript over words once rendered, 0..1; null when not rendered. */
  text_share: number | null;
}

export function readableScore(pages: readonly ReadablePage[]): Measure {
  const byTemplate = new Map<string, { pages: number; shares: number[] }>();
  for (const p of pages) {
    const t = byTemplate.get(p.template_key) ?? { pages: 0, shares: [] };
    t.pages += 1;
    if (p.text_share !== null) t.shares.push(Math.min(1, Math.max(0, p.text_share)));
    byTemplate.set(p.template_key, t);
  }
  let known = 0;
  let unrendered = 0;
  for (const t of byTemplate.values()) {
    if (t.shares.length === 0) unrendered += t.pages;
    else known += t.pages * median(t.shares);
  }
  const total = pages.length;
  if (total === 0) return ranged(0, AI_WEIGHTS.readable);
  const of = (x: number) => (AI_WEIGHTS.readable * x) / total;
  return unrendered === 0 ? scored(of(known)) : ranged(of(known), of(known + unrendered));
}
