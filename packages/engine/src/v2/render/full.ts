/**
 * Row 17's full render: every page a check read, rendered and measured, not the sample. A Pro account
 * has 10 a month and an Agency account 30 (`GATES[tier].fullRendersPerMonth`). The pipeline renders a
 * full render in chunks of FULL_RENDER_CHUNK_PAGES, one step each, under one budget of browser time;
 * this module plans it and merges the chunks with the check's sampled render.
 *
 * WHAT IT RENDERS. Every crawled page the graded phase may render (sample.ts `renderable`), picked
 * by the same rules as the sample (`selectRenders`) with no cap on their number, less the pages the
 * check's sampled render already rendered.
 *
 * WHAT IT COSTS, AT MOST. FULL_RENDER_MAX_BROWSER_MS of browser time, whatever a request costs: each
 * chunk's allowance is what the budget has left, and rendering stops for the rest when it cannot take
 * a page's two renders (`check_cap`). A page not reached is named in the outcome as not rendered, with
 * why, so the count of pages measured is read from the data.
 */
import {
  RESERVE_PER_RENDER_MS,
  type NotRenderedReason,
  type RenderedPage,
  type RenderOutcome,
} from './run.js';
import { siteEstimate } from './estimate.js';
import { oncePerUrl, selectRenders, type RenderCandidate, type SampledPage } from './sample.js';

/**
 * The most browser time one full render may spend: 13,600 s. At Browser Run's $0.09 a browser-hour
 * that is 13,600 × 0.09 ÷ 3,600 = $0.34, and Pro's 10 a month are $3.40, 18% of its $19 (inbox 100).
 */
export const FULL_RENDER_MAX_BROWSER_MS = 13_600_000;

/**
 * What a page reserves before it renders: its two renders' request timeouts (run.ts). A full render
 * whose budget has less than this left can start no page, so it stops.
 */
export const FULL_RENDER_PAGE_RESERVE_MS = 2 * RESERVE_PER_RENDER_MS;

/** The pages one step of a full render renders: two renders each, inside the route's 300 s. */
export const FULL_RENDER_CHUNK_PAGES = 25;

/**
 * The pages a full render renders, in the order it renders them: every renderable candidate, picked
 * as the sample picks, less those `sampled` already holds (rendered or not: the sample's own reason
 * stands for them).
 */
export function fullRenderPlan(
  candidates: readonly RenderCandidate[],
  sampled: Pick<RenderOutcome, 'pages'>,
): SampledPage[] {
  const held = new Set(sampled.pages.map((p) => p.url));
  return selectRenders(candidates, [], candidates.length).filter((p) => !held.has(p.url));
}

/**
 * The check's render outcome after a full render: the sampled render's pages, then each chunk's, then
 * every planned page no chunk reached, not rendered with `notReached` (the budget spent: `check_cap`;
 * the full render's time spent: `out_of_time`). The browser time is the sum; the site estimate is
 * recomputed over every graded candidate, the measured pages being every page rendered. `full` marks
 * it, so the build admits a render of any renderable page.
 */
export function mergeFullRender(
  sampled: RenderOutcome,
  chunks: readonly RenderOutcome[],
  plan: readonly SampledPage[],
  candidates: readonly RenderCandidate[],
  notReached: Extract<NotRenderedReason, 'check_cap' | 'out_of_time'>,
): RenderOutcome {
  const pages: RenderedPage[] = [...sampled.pages];
  const seen = new Set(pages.map((p) => p.url));
  for (const p of chunks.flatMap((c) => c.pages)) {
    if (seen.has(p.url)) continue;
    seen.add(p.url);
    pages.push(p);
  }
  for (const p of plan) {
    if (seen.has(p.url)) continue;
    seen.add(p.url);
    pages.push({ ...p, rendered: false, reason: notReached });
  }
  const shares = new Map(
    pages.flatMap((p) =>
      p.rendered && p.picked_for !== 'empty_root'
        ? [[p.url, p.without_js.text_share] as const]
        : [],
    ),
  );
  const graded = (c: RenderCandidate) => c.kind === 'content' && c.status_code === 200 && c.is_html;
  const estimate = siteEstimate(
    oncePerUrl(candidates.filter(graded)).map((c) => ({
      template_key: c.template_key,
      text_share: shares.get(c.url) ?? null,
    })),
  );
  return {
    pages,
    browser_ms: sampled.browser_ms + chunks.reduce((n, c) => n + c.browser_ms, 0),
    estimate,
    settle_failed: sampled.settle_failed || chunks.some((c) => c.settle_failed),
    full: true,
  };
}
