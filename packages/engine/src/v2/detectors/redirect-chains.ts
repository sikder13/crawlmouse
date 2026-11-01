/**
 * redirect_chain: an internal link whose target answers only after REDIRECT_CHAIN_MIN_HOPS redirects
 * or more, or never, because the redirects loop.
 *
 * Judged once per link target, as the link spells it, of a crawled 200 page. The fix is made on the
 * linking pages (point the link at the final URL), so they are the affected pages. A verdict needs
 * the recorded hop count: a request that ended at its own URL may still have gone round a loop of
 * redirects back to it. A target that is where another request ended answered without a redirect.
 */
import type { LinkEdge } from '@crawlmouse/types/v2';
import { goneStatus, record, scopeOf, uncrawledRecords, type Scope } from './scope.js';
import { REDIRECT_CHAIN_MIN_HOPS } from './thresholds.js';
import type { Detection, DetectorInput } from './types.js';

/** Links from crawled 200 pages by their target as written. */
function linksByTarget(s: Scope): Map<string, LinkEdge[]> {
  const ok = new Set(s.ok);
  const by = new Map<string, LinkEdge[]>();
  for (const e of s.input.edges) {
    const from = s.resolve(e.from_url);
    if (!ok.has(from) || from === s.resolve(e.to_url)) continue;
    by.set(e.to_url, [...(by.get(e.to_url) ?? []), { ...e, from_url: from }]);
  }
  return by;
}

function judge(target: string, linking: LinkEdge[], s: Scope): Detection | null {
  const base = { affected: linking.map((e) => e.from_url), pages: [target], edges: linking };
  const page = s.page.get(target);
  if (page === undefined) {
    // Where another crawled page's request ended: it answered there without a redirect.
    const landedFrom = s.resolve(target);
    if (landedFrom === target) return null; // not crawled: uncrawledRecords reports it
    return record('redirect_chain', target, {
      ...base,
      pages: [landedFrom],
      measured: 0,
      state: 'not_detected',
    });
  }
  const gone = goneStatus(page);
  if (gone !== null) {
    return record('redirect_chain', target, {
      ...base,
      state: 'indeterminate',
      reason: 'page_gone',
      page_gone: gone,
    });
  }
  const redirect = s.facts.get(target)?.redirect ?? null;
  if (redirect === null) {
    return record('redirect_chain', target, {
      ...base,
      state: 'indeterminate',
      reason: 'hops_not_recorded',
    });
  }
  const chain = redirect.loop || redirect.hops >= REDIRECT_CHAIN_MIN_HOPS;
  return record('redirect_chain', target, {
    ...base,
    measured: redirect.hops,
    state: chain ? 'detected' : 'not_detected',
    conditions: redirect.loop ? ['redirect_loop'] : [],
  });
}

export function detectRedirectChains(input: DetectorInput): Detection[] {
  const s = scopeOf(input);
  const judged = [...linksByTarget(s)].flatMap(
    ([target, linking]) => judge(target, linking, s) ?? [],
  );
  return [...judged, ...uncrawledRecords('redirect_chain', s)];
}
