/**
 * canonical_mismatch: a crawled 200 page whose rel=canonical cannot be honoured, or that the site
 * links to under a URL that is not its canonical.
 *
 * Judged when the page declares a canonical other than itself (a self-canonical page, or one that
 * declares none, is self-consistent). The canonical is broken when it points to another host, to a
 * URL robots.txt disallows, to a page that answers a redirect or a 4xx (a 429 or 5xx is unknown), or
 * to a page that itself declares a canonical elsewhere (not in canonical form). A link to the page
 * from a crawled 200 page is a link under a non-canonical URL. Any proven condition decides;
 * otherwise an unread fact leaves the record indeterminate. "Nothing links here" is proven only on a
 * complete crawl.
 */
import { sameHostIgnoringWww } from '../../extract.js';
import { goneRecords, hidesLinks, record, scopeOf, uncrawledRecords, type Scope } from './scope.js';
import type { Condition, Detection, DetectorInput, IndeterminateReason } from './types.js';

type TargetFinding = { condition: Condition } | { unknown: IndeterminateReason } | null;

/** What the canonical's target shows: a broken canonical, an unread fact, or nothing wrong. */
function judgeTarget(page: string, target: string, s: Scope): TargetFinding {
  if (!sameHostIgnoringWww(new URL(target), new URL(page)))
    return { condition: 'canonical_cross_host' };
  if (s.input.robots_disallowed?.includes(target))
    return { condition: 'canonical_target_disallowed' };
  const result = s.page.get(target);
  if (result === undefined) return { unknown: 'canonical_target_not_fetched' };
  if (hidesLinks(result.status_code)) return { unknown: 'canonical_target_errored' };
  if (result.status_code !== 200) return { condition: 'canonical_target_not_200' };
  const own = s.facts.get(target)?.canonical ?? null;
  if (own === null) return { unknown: 'canonical_not_read' };
  if (own.href !== null && own.href !== target)
    return { condition: 'canonical_target_not_canonical' };
  return null;
}

function judge(url: string, s: Scope): Detection {
  const canonical = s.facts.get(url)?.canonical ?? null;
  if (canonical === null) {
    return record('canonical_mismatch', url, {
      state: 'indeterminate',
      reason: 'canonical_not_read',
      affected: [url],
      pages: [url],
    });
  }
  const target = canonical.href;
  if (target === null || target === url) {
    return record('canonical_mismatch', url, {
      state: 'not_detected',
      affected: [url],
      pages: [url],
    });
  }
  const inbound = s.in.get(url) ?? [];
  const found = judgeTarget(url, target, s);
  const conditions: Condition[] = [];
  if (found !== null && 'condition' in found) conditions.push(found.condition);
  if (inbound.length > 0) conditions.push('linked_under_non_canonical');
  const pages = s.page.has(target) ? [url, target] : [url];
  const base = { affected: [url], pages, edges: inbound, measured: inbound.length };
  if (conditions.length > 0)
    return record('canonical_mismatch', url, { ...base, state: 'detected', conditions });
  if (found !== null && 'unknown' in found) {
    return record('canonical_mismatch', url, {
      ...base,
      state: 'indeterminate',
      reason: found.unknown,
    });
  }
  if (s.truncated)
    return record('canonical_mismatch', url, {
      ...base,
      state: 'indeterminate',
      reason: 'crawl_truncated',
    });
  if (s.linksIncomplete) {
    return record('canonical_mismatch', url, {
      ...base,
      state: 'indeterminate',
      reason: 'links_not_fully_recorded',
    });
  }
  return record('canonical_mismatch', url, { ...base, state: 'not_detected' });
}

export function detectCanonicalMismatch(input: DetectorInput): Detection[] {
  const s = scopeOf(input);
  return [
    ...s.ok.map((url) => judge(url, s)),
    ...goneRecords('canonical_mismatch', s),
    ...uncrawledRecords('canonical_mismatch', s),
  ];
}
