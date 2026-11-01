/**
 * orphan_pages: a gradeable 200 page that no other crawled 200 page links to.
 *
 * The cap-safe rule (docs/tickets/2026-08-07-orphan-under-cap.md): "no inbound link" is only proven
 * when the pages that could link were read, so a truncated crawl, or one where some links were not
 * seen (scope.ts `linksIncomplete`), cannot detect an orphan. One inbound link is proof on any crawl.
 */
import { isGradeable, record, scopeOf, goneRecords, uncrawledRecords } from './scope.js';
import type { Detection, DetectorInput } from './types.js';

export function detectOrphans(input: DetectorInput): Detection[] {
  const s = scopeOf(input);
  const judged = s.ok
    .map((url) => s.page.get(url)!)
    .filter((p) => isGradeable(p) && p.url !== input.homepage_url)
    .map((p) => {
      const inbound = s.in.get(p.url) ?? [];
      const base = { measured: inbound.length, affected: [p.url], pages: [p.url], edges: inbound };
      if (inbound.length > 0)
        return record('orphan_pages', p.url, { ...base, state: 'not_detected' });
      if (s.truncated)
        return record('orphan_pages', p.url, {
          ...base,
          state: 'indeterminate',
          reason: 'crawl_truncated',
        });
      if (s.linksIncomplete) {
        return record('orphan_pages', p.url, {
          ...base,
          state: 'indeterminate',
          reason: 'links_not_fully_recorded',
        });
      }
      return record('orphan_pages', p.url, { ...base, state: 'detected' });
    });
  return [...judged, ...goneRecords('orphan_pages', s), ...uncrawledRecords('orphan_pages', s)];
}
