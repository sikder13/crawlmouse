/**
 * duplicate_pagination: a later page of a paginated list that repeats page 1, judged per template.
 *
 * A later page is detected when its content simhash is within SIMHASH_HAMMING_K bits of page 1's, or
 * when it declares page 1 as its canonical (content that differs is then consolidated away; content
 * that repeats is the first case). Pagination is found by URL with v1's rule (`classifyUrlKind`), not
 * by the page kind v1 assigned, which a near-duplicate can lose to `duplicate`.
 *
 * A template is detected when any of its later pages is. It is clear only when each later page that
 * was crawled, and neither redirects nor is gone, was read at its own URL and decided clear, and
 * `absenceUnproven` (scope.ts) finds nothing the crawl missed: an unfetched page could repeat page 1.
 */
import { canonicalizeUrl } from '../../url-canonical.js';
import { classifyUrlKind } from '../../analysis/page-kind.js';
import { hammingDistance } from '../../analysis/simhash.js';
import { absenceUnproven, byText, isUnread, record, scopeOf, sorted, type Scope } from './scope.js';
import { SIMHASH_HAMMING_K } from './thresholds.js';
import type { Condition, Detection, DetectorInput, IndeterminateReason } from './types.js';

/** The query keys v1's pagination rule reads, in its order; `offset` and `start` count from 0. */
const PAGE_KEYS = ['page', 'paged', 'pg', 'offset', 'start'] as const;
const ZERO_BASED: ReadonlySet<string> = new Set(['offset', 'start']);

/**
 * The first page of the list `url` is a later page of, in canonical spelling; null when `url` is not
 * a pagination URL or is itself the first page. Mirrors the pagination rule in page-kind.ts: a path
 * segment `page` followed by a number, else the first of PAGE_KEYS with a numeric value.
 */
export function firstPageOf(url: string): string | null {
  if (classifyUrlKind(url) !== 'pagination') return null;
  const parsed = new URL(url);
  const segments = parsed.pathname.split('/').filter(Boolean);
  const at = segments.findIndex((seg) => safeDecode(seg).toLowerCase() === 'page');
  if (at !== -1 && /^\d+$/.test(segments[at + 1] ?? '')) {
    if (Number(segments[at + 1]) <= 1) return null;
    segments.splice(at, 2);
    parsed.pathname = `/${segments.join('/')}`;
    return canonicalizeUrl(parsed.toString());
  }
  for (const key of PAGE_KEYS) {
    const matching = [...parsed.searchParams].filter(([k]) => k.toLowerCase() === key);
    const value = matching[0]?.[1];
    if (value === undefined || !/^\d+$/.test(value)) continue;
    if (Number(value) <= (ZERO_BASED.has(key) ? 0 : 1)) return null;
    for (const [name] of matching) parsed.searchParams.delete(name);
    return canonicalizeUrl(parsed.toString());
  }
  return null;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

interface PageVerdict {
  url: string;
  first: string;
  state: Detection['state'];
  reason?: IndeterminateReason;
  conditions: Condition[];
}

/** Where the request for `url` ended: at `url` itself, elsewhere, or not recorded. */
function landedAt(url: string, s: Scope): 'itself' | 'elsewhere' | 'unknown' {
  const landed = s.facts.get(url)?.final_url ?? null;
  return landed === null ? 'unknown' : landed === url ? 'itself' : 'elsewhere';
}

function judge(url: string, first: string, s: Scope): PageVerdict {
  const verdict = (state: Detection['state'], extra: Partial<PageVerdict> = {}): PageVerdict => ({
    url,
    first,
    state,
    conditions: [],
    ...extra,
  });
  if (s.page.get(first)?.status_code !== 200 || landedAt(first, s) === 'elsewhere') {
    return verdict('indeterminate', { reason: 'first_page_not_crawled' });
  }
  if (isUnread(s.page.get(url)!.status_code) || landedAt(url, s) === 'unknown') {
    return verdict('indeterminate', { reason: 'page_not_read' });
  }
  const mine = s.facts.get(url)?.simhash ?? null;
  const theirs = s.facts.get(first)?.simhash ?? null;
  const canonical = s.facts.get(url)?.canonical ?? null;
  const conditions: Condition[] = [];
  if (mine !== null && theirs !== null && hammingDistance(mine, theirs) <= SIMHASH_HAMMING_K) {
    conditions.push('pagination_near_duplicate');
  }
  if (canonical !== null && canonical.href === first)
    conditions.push('pagination_canonical_to_first');
  if (conditions.length > 0) return verdict('detected', { conditions });
  if (mine === null || theirs === null)
    return verdict('indeterminate', { reason: 'content_not_hashed' });
  if (canonical === null) return verdict('indeterminate', { reason: 'canonical_not_read' });
  return verdict('not_detected');
}

export function detectDuplicatePagination(input: DetectorInput): Detection[] {
  const s = scopeOf(input);
  const byTemplate = new Map<string, PageVerdict[]>();
  // In URL order: a template's reason is its first undecided page's, whatever the input order.
  for (const p of [...s.input.pages].sort((a, b) => byText(a.url, b.url))) {
    const first = firstPageOf(p.url);
    // A later page that redirects, or is gone, is not a page of the list; one that answered 401,
    // 403, 429 or 5xx is, and was not read.
    if (first === null || (p.status_code !== 200 && !isUnread(p.status_code))) continue;
    if (landedAt(p.url, s) === 'elsewhere') continue;
    const url = p.url;
    const template = p.template_key;
    byTemplate.set(template, [...(byTemplate.get(template) ?? []), judge(url, first, s)]);
  }
  return [...byTemplate].map(([template, verdicts]) => {
    const detected = verdicts.filter((v) => v.state === 'detected');
    const undecided = verdicts.filter((v) => v.state === 'indeterminate');
    const pagesOf = (vs: PageVerdict[]) =>
      vs.flatMap((v) => (s.page.has(v.first) ? [v.url, v.first] : [v.url]));
    if (detected.length > 0) {
      return record('duplicate_pagination', template, {
        state: 'detected',
        measured: detected.length,
        conditions: detected.flatMap((v) => v.conditions),
        affected: detected.map((v) => v.url),
        pages: pagesOf(detected),
      });
    }
    const base = { measured: 0, pages: pagesOf(verdicts) };
    if (undecided.length > 0) {
      return record('duplicate_pagination', template, {
        ...base,
        state: 'indeterminate',
        reason: undecided[0]!.reason!,
        affected: sorted(undecided.map((v) => v.url)),
      });
    }
    const unproven = absenceUnproven(s);
    if (unproven !== null) {
      return record('duplicate_pagination', template, {
        ...base,
        state: 'indeterminate',
        reason: unproven,
      });
    }
    return record('duplicate_pagination', template, { ...base, state: 'not_detected' });
  });
}
