/**
 * generic_anchor_text: a hub page whose outbound links are mostly generic ("click here").
 *
 * Hubs are the top TOP_HUB_FRACTION of the crawled 200 pages by PageRank share (at least one; ties go
 * to the lower URL), the cut v1's structure score uses. On a truncated crawl they are the hubs of
 * what was crawled. A hub's own links are all on the hub, so its share is measured whole, unless the
 * page found more links than were recorded; then the share is a range and decides only if the whole
 * range falls on one side of a threshold. Between the two thresholds the record is `indeterminate`,
 * which the lifecycle reads as "leave an open fix open, open no new one".
 */
import { byText, record, scopeOf } from './scope.js';
import {
  GENERIC_CLEAR_AT_OR_BELOW,
  GENERIC_DETECT_ABOVE,
  MIN_HUB_OUTLINKS,
  TOP_HUB_FRACTION,
} from './thresholds.js';
import type { Detection, DetectorInput } from './types.js';

/** The hub URLs, highest PageRank share first. */
export function hubsOf(input: DetectorInput): string[] {
  const ranked = input.pages
    .filter((p) => p.status_code === 200 && p.pagerank_share !== null)
    .sort((a, b) => b.pagerank_share! - a.pagerank_share! || byText(a.url, b.url));
  const hubs = Math.max(1, Math.ceil(TOP_HUB_FRACTION * ranked.length));
  return ranked.filter((_, rank) => rank < hubs).map((p) => p.url);
}

export function detectGenericAnchors(input: DetectorInput): Detection[] {
  const s = scopeOf(input);
  return hubsOf(input).map((hub) => {
    const recorded = s.out.get(hub) ?? [];
    const generic = recorded.filter((e) => e.is_generic_anchor);
    const total = Math.max(s.linksOut(hub), recorded.length);
    const unrecorded = total - recorded.length;
    const base = {
      measured: recorded.length === 0 ? null : generic.length / recorded.length,
      affected: [hub],
      pages: [hub],
      edges: generic,
    };
    if (total < MIN_HUB_OUTLINKS) {
      return record('generic_anchor_text', hub, {
        ...base,
        state: 'indeterminate',
        reason: 'too_few_links',
      });
    }
    const least = generic.length / total;
    const most = (generic.length + unrecorded) / total;
    if (least > GENERIC_DETECT_ABOVE)
      return record('generic_anchor_text', hub, { ...base, state: 'detected' });
    if (most <= GENERIC_CLEAR_AT_OR_BELOW)
      return record('generic_anchor_text', hub, { ...base, state: 'not_detected' });
    const inBand = least > GENERIC_CLEAR_AT_OR_BELOW && most <= GENERIC_DETECT_ABOVE;
    return record('generic_anchor_text', hub, {
      ...base,
      state: 'indeterminate',
      reason: inBand ? 'hysteresis_band' : 'links_not_fully_recorded',
    });
  });
}
