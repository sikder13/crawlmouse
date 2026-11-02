/**
 * canonical_mismatch: a crawled 200 page whose rel=canonical cannot be honoured, or that the site
 * links to under a URL that is not its canonical.
 *
 * Judged when the request for the page ended at the page itself (`PageFacts.final_url`): a page that
 * redirected carries the canonical of where it landed, and links to it are the redirect detector's.
 * A page that declares no canonical, or itself, is self-consistent. The canonical is broken when it
 * points to another host, to a URL robots.txt disallows for every search engine, to a URL that
 * redirects (a stopped 3xx, or a 200 that landed elsewhere) or is gone, or to a page that declares a
 * canonical elsewhere (not in canonical form). A target robots.txt kept our crawler from, and not
 * every search engine, is unread. A link to the page
 * from a crawled 200 page is a link under a non-canonical URL. Any proven condition decides;
 * otherwise an unread fact leaves the record indeterminate, and "nothing links here" needs
 * `absenceUnproven` (scope.ts) to find nothing the crawl missed.
 */
import { sameHostIgnoringWww } from '../../extract.js';
import {
  absenceUnproven,
  disallowedForSearch,
  goneRecords,
  goneStatus,
  isUnread,
  record,
  scopeOf,
  uncrawledRecords,
  type Scope,
} from './scope.js';
import type { Condition, Detection, DetectorInput, IndeterminateReason } from './types.js';

type TargetFinding = { condition: Condition } | { unknown: IndeterminateReason } | null;

const parse = (url: string): URL | null => {
  try {
    return new URL(url);
  } catch {
    return null;
  }
};

/** What the canonical's target shows: a broken canonical, an unread fact, or nothing wrong. */
function judgeTarget(page: string, target: string, s: Scope): TargetFinding {
  const to = parse(target);
  if (to === null) return { unknown: 'canonical_not_read' };
  if (!sameHostIgnoringWww(to, new URL(page))) return { condition: 'canonical_cross_host' };
  // The crawled page that answered at the target: the target itself, or a page that landed there.
  const at = s.resolve(target);
  const result = s.page.get(at);
  if (result === undefined) {
    const blocked = s.disallowed.get(target);
    if (blocked !== undefined && disallowedForSearch(blocked)) {
      return { condition: 'canonical_target_disallowed' };
    }
    return { unknown: 'canonical_target_not_fetched' };
  }
  // The verdicts on a row are for the URL that row requested: only the target's own row has them. A
  // target that is only where another request landed has none recorded.
  if (at === target && disallowedForSearch(result.robots_search)) {
    return { condition: 'canonical_target_disallowed' };
  }
  if (isUnread(result.status_code)) return { unknown: 'canonical_target_not_read' };
  if (goneStatus(result) !== null) return { condition: 'canonical_target_gone' };
  // A redirect the crawl stopped at, or one it followed (a 200 that landed somewhere else).
  if (result.status_code !== 200) return { condition: 'canonical_target_redirects' };
  const own = s.facts.get(at);
  const landed = own?.final_url ?? null;
  if (landed === null) return { unknown: 'canonical_not_read' };
  if (landed !== target) return { condition: 'canonical_target_redirects' };
  if (own?.canonical == null) return { unknown: 'canonical_not_read' };
  if (own.canonical.href !== null && own.canonical.href !== target) {
    return { condition: 'canonical_target_not_canonical' };
  }
  return null;
}

function judge(url: string, s: Scope): Detection | null {
  const facts = s.facts.get(url);
  const unread = { state: 'indeterminate', affected: [url], pages: [url] } as const;
  if (facts?.canonical == null || facts.final_url === null) {
    return record('canonical_mismatch', url, { ...unread, reason: 'canonical_not_read' });
  }
  if (facts.final_url !== url) return null;
  const target = facts.canonical.href;
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
  const at = s.resolve(target);
  const pages = s.page.has(at) ? [url, at] : [url];
  const base = { affected: [url], pages, edges: inbound, measured: inbound.length };
  if (conditions.length > 0) {
    return record('canonical_mismatch', url, { ...base, state: 'detected', conditions });
  }
  if (found !== null && 'unknown' in found) {
    return record('canonical_mismatch', url, {
      ...base,
      state: 'indeterminate',
      reason: found.unknown,
    });
  }
  const unproven = absenceUnproven(s);
  if (unproven !== null) {
    return record('canonical_mismatch', url, { ...base, state: 'indeterminate', reason: unproven });
  }
  return record('canonical_mismatch', url, { ...base, state: 'not_detected' });
}

export function detectCanonicalMismatch(input: DetectorInput): Detection[] {
  const s = scopeOf(input);
  return [
    ...s.ok.flatMap((url) => judge(url, s) ?? []),
    ...goneRecords('canonical_mismatch', s),
    ...uncrawledRecords('canonical_mismatch', s),
  ];
}
