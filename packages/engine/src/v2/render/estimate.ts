/**
 * The site-wide share of words served without JavaScript, estimated from the rendered pages.
 *
 *   ratio(t)        = median text_share of template t's rendered pages
 *   site_text_share = Σ_t pages(t) × ratio(t) / Σ_t pages(t), over the templates with a rendered page
 *
 * `pages(t)` is t's graded pages, the weight CC-17's Readable uses. A template with no rendered page
 * has no ratio, so it is left out of the share rather than guessed at, and `unrendered_share` says how
 * much of the graded site that leaves out. From the two, Readable's range follows:
 *
 *   low  = 30 × site_text_share × (1 − unrendered_share)      high = low + 30 × unrendered_share
 *
 * The input is the graded pages in the shape Readable reads (`template_key`, `text_share`).
 */

export interface GradedPageShare {
  template_key: string;
  /** Null when the page was not rendered, or was rendered and not measured. */
  text_share: number | null;
}

export interface SiteEstimate {
  site_text_share: number | null;
  rendered_pages: number;
  templates_rendered: number;
  templates_total: number;
  /** Graded pages in a template with no rendered page, over all graded pages; 1 when none is graded. */
  unrendered_share: number;
  /**
   * Of the weight behind site_text_share, the part resting on templates with a single rendered page:
   * their ratio is one page's share. 0 when nothing was rendered.
   */
  single_render_weight: number;
  /**
   * "estimated from N rendered pages across K of T templates", then, where they are above zero, the
   * percentage of graded pages in templates with no measured page and the percentage of the estimate's
   * weight resting on a single measured page per template. Null when nothing was measured.
   */
  label: string | null;
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A share as a whole percentage, never rounded down to 0 % or up to 100 % when it is neither. */
function percent(x: number): string {
  const p = Math.round(x * 100);
  return `${x > 0 && p === 0 ? '<1' : x < 1 && p === 100 ? '>99' : p} %`;
}

export function siteEstimate(pages: readonly GradedPageShare[]): SiteEstimate {
  const templates = new Map<string, { pages: number; shares: number[] }>();
  for (const p of pages) {
    const t = templates.get(p.template_key) ?? { pages: 0, shares: [] };
    t.pages += 1;
    if (p.text_share !== null) t.shares.push(Math.min(1, Math.max(0, p.text_share)));
    templates.set(p.template_key, t);
  }
  let weighted = 0;
  let renderedWeight = 0;
  let renderedPages = 0;
  let templatesRendered = 0;
  let singleWeight = 0;
  for (const t of templates.values()) {
    if (t.shares.length === 0) continue;
    weighted += t.pages * median(t.shares);
    renderedWeight += t.pages;
    renderedPages += t.shares.length;
    templatesRendered += 1;
    if (t.shares.length === 1) singleWeight += t.pages;
  }
  const total = templates.size;
  const site_text_share = renderedWeight === 0 ? null : weighted / renderedWeight;
  const unrendered_share = pages.length === 0 ? 1 : (pages.length - renderedWeight) / pages.length;
  const single_render_weight = renderedWeight === 0 ? 0 : singleWeight / renderedWeight;
  const clauses = [
    `estimated from ${plural(renderedPages, 'rendered page')} across ${templatesRendered} of ${plural(total, 'template')}`,
    ...(unrendered_share > 0
      ? [`${percent(unrendered_share)} of graded pages are in templates with no measured page`]
      : []),
    ...(single_render_weight > 0
      ? [
          `${percent(single_render_weight)} of the estimate's weight rests on one measured page per template`,
        ]
      : []),
  ];
  return {
    site_text_share,
    rendered_pages: renderedPages,
    templates_rendered: templatesRendered,
    templates_total: total,
    unrendered_share,
    single_render_weight,
    label: site_text_share === null ? null : clauses.join('; '),
  };
}
