/**
 * redirect_chain: an internal link whose target answers only after REDIRECT_CHAIN_MIN_HOPS redirects
 * or more, or never, because the redirects loop.
 *
 * Judged once per link target of a crawled 200 page. The fix is made on the linking pages (point the
 * link at the final URL), so they are the affected pages. Without a hop count, a request that ended at
 * its own URL had no redirect; one that ended anywhere else had at least one, and how many is unknown.
 */
import { record, scopeOf, uncrawledRecords } from './scope.js';
import { REDIRECT_CHAIN_MIN_HOPS } from './thresholds.js';
import type { Detection, DetectorInput } from './types.js';

export function detectRedirectChains(input: DetectorInput): Detection[] {
  const s = scopeOf(input);
  const judged = [...s.in.keys()]
    .filter((target) => s.page.has(target))
    .map((target) => {
      const linking = s.in.get(target)!;
      const facts = s.facts.get(target);
      const base = { affected: linking.map((e) => e.from_url), pages: [target], edges: linking };
      if (facts?.redirect) {
        const { hops, loop } = facts.redirect;
        const chain = loop || hops >= REDIRECT_CHAIN_MIN_HOPS;
        return record('redirect_chain', target, {
          ...base,
          measured: hops,
          state: chain ? 'detected' : 'not_detected',
          conditions: loop ? ['redirect_loop'] : [],
        });
      }
      if (facts?.final_url === target)
        return record('redirect_chain', target, { ...base, measured: 0, state: 'not_detected' });
      return record('redirect_chain', target, {
        ...base,
        state: 'indeterminate',
        reason: 'hops_not_recorded',
      });
    });
  return [...judged, ...uncrawledRecords('redirect_chain', s)];
}
