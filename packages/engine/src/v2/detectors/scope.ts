/**
 * What every structure detector needs to know about the crawl before judging anything: which pages
 * it holds, which links those pages carry, whether it was cut short, and whether every link a page
 * had was recorded.
 */
import type { LinkEdge, PageResult } from '@crawlmouse/types/v2';
import { fingerprintKey, fingerprintOf, type StructureFixType } from './fingerprint.js';
import { GONE_STATUSES, MIN_CRAWL_COVERAGE } from './thresholds.js';
import type {
  Condition,
  Detection,
  DetectorInput,
  IndeterminateReason,
  PageFacts,
} from './types.js';

export const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
export const sorted = (xs: Iterable<string>): string[] => [...new Set(xs)].sort(byText);

/**
 * A 429 or a 5xx: the page exists and its links were not seen, so a link from it may be missing here.
 * Other non-200 answers show no links to any crawler (a redirect, a 4xx refusal, a gone page), so a
 * page that answers them links to nothing a crawler can follow.
 */
export const hidesLinks = (status: number): boolean => status === 429 || status >= 500;

export interface Scope {
  input: DetectorInput;
  /** Every crawled page, by URL. */
  page: ReadonlyMap<string, PageResult>;
  facts: ReadonlyMap<string, PageFacts>;
  /** Crawled pages that answered 200, sorted. */
  ok: readonly string[];
  /** Links from crawled 200 pages to other URLs, by source and by target, each sorted. */
  out: ReadonlyMap<string, readonly LinkEdge[]>;
  in: ReadonlyMap<string, readonly LinkEdge[]>;
  /** Link targets of crawled 200 pages that were not crawled themselves, sorted. */
  uncrawledTargets: readonly string[];
  /** The crawl was cut short: unfetched pages may hold links nothing here has seen. */
  truncated: boolean;
  /**
   * Links the crawl reached but did not see: a crawled 200 page found more links than were recorded,
   * or a crawled page answered 429 or 5xx (`hidesLinks`), which hid whatever it links to.
   */
  linksIncomplete: boolean;
}

function indexBy<T extends { url: string }>(rows: readonly T[], what: string): Map<string, T> {
  const out = new Map<string, T>();
  for (const r of rows) {
    if (out.has(r.url)) throw new Error(`structure detectors: ${what} lists ${r.url} twice`);
    out.set(r.url, r);
  }
  return out;
}

/**
 * Truncated when the page cap was reached, the check is `partial` (a budget was spent or the site
 * stopped the crawl), the crawl fetched under MIN_CRAWL_COVERAGE of the URLs it discovered, or there
 * is no coverage to tell.
 */
export function isTruncated(input: DetectorInput): boolean {
  const c = input.check.coverage;
  if (c === null || input.check.status === 'partial') return true;
  if (c.pages_crawled >= input.page_cap) return true;
  return c.pages_discovered > 0 && c.pages_crawled / c.pages_discovered < MIN_CRAWL_COVERAGE;
}

export function scopeOf(input: DetectorInput): Scope {
  const page = indexBy(input.pages, 'pages');
  const facts = indexBy(input.facts, 'facts');
  const ok = sorted(input.pages.filter((p) => p.status_code === 200).map((p) => p.url));
  const okSet = new Set(ok);
  const out = new Map<string, LinkEdge[]>();
  const into = new Map<string, LinkEdge[]>();
  for (const e of input.edges) {
    if (!okSet.has(e.from_url) || e.from_url === e.to_url) continue;
    (out.get(e.from_url) ?? out.set(e.from_url, []).get(e.from_url)!).push(e);
    (into.get(e.to_url) ?? into.set(e.to_url, []).get(e.to_url)!).push(e);
  }
  for (const list of out.values()) list.sort((a, b) => byText(a.to_url, b.to_url));
  for (const list of into.values()) list.sort((a, b) => byText(a.from_url, b.from_url));
  const linksIncomplete =
    ok.some((url) => page.get(url)!.links_out > (out.get(url)?.length ?? 0)) ||
    input.pages.some((p) => hidesLinks(p.status_code));
  return {
    input,
    page,
    facts,
    ok,
    out,
    in: into,
    uncrawledTargets: sorted([...into.keys()].filter((url) => !page.has(url))),
    truncated: isTruncated(input),
    linksIncomplete,
  };
}

/** 404 or 410: the page is no longer there. */
export function goneStatus(p: PageResult): 404 | 410 | null {
  return GONE_STATUSES.find((s) => s === p.status_code) ?? null;
}

export interface Verdict {
  state: Detection['state'];
  reason?: IndeterminateReason;
  page_gone?: 404 | 410;
  measured?: number | null;
  conditions?: Iterable<Condition>;
  affected?: Iterable<string>;
  pages?: Iterable<string>;
  edges?: Iterable<Pick<LinkEdge, 'from_url' | 'to_url'>>;
}

/** A Detection for `subject`, its lists sorted so the output does not depend on input order. */
export function record(type: StructureFixType, subject: string, v: Verdict): Detection {
  const key = fingerprintKey(type, subject);
  if ((v.state === 'indeterminate') !== (v.reason !== undefined)) {
    throw new Error(`structure detectors: ${key} is ${v.state} with reason ${v.reason ?? 'none'}`);
  }
  const conditions = sorted(v.conditions ?? []) as Condition[];
  if (conditions.length > 0 && v.state !== 'detected') {
    throw new Error(
      `structure detectors: ${key} is ${v.state} with conditions ${conditions.join(', ')}`,
    );
  }
  const edges = [...(v.edges ?? [])].map(({ from_url, to_url }) => ({ from_url, to_url }));
  edges.sort((a, b) => byText(a.from_url, b.from_url) || byText(a.to_url, b.to_url));
  return {
    type,
    fingerprint: fingerprintOf(key),
    key,
    state: v.state,
    reason: v.reason ?? null,
    page_gone: v.page_gone === undefined ? null : { status_code: v.page_gone },
    measured: v.measured ?? null,
    conditions,
    affected_urls: sorted(v.affected ?? []),
    evidence: { pages: sorted(v.pages ?? []), edges },
  };
}

/** A crawled page that answered 404 or 410: no longer there, so neither broken nor fixed. */
export const goneRecords = (type: StructureFixType, s: Scope): Detection[] =>
  s.input.pages.flatMap((p) => {
    const status = goneStatus(p);
    return status === null
      ? []
      : [
          record(type, p.url, {
            state: 'indeterminate',
            reason: 'page_gone',
            page_gone: status,
            pages: [p.url],
          }),
        ];
  });

/** A URL a crawled 200 page links to that was not crawled: nothing about it was read. */
export const uncrawledRecords = (type: StructureFixType, s: Scope): Detection[] =>
  s.uncrawledTargets.map((url) =>
    record(type, url, { state: 'indeterminate', reason: 'not_crawled', edges: s.in.get(url) }),
  );

/** Gradeable: a `content` page that answered 200 (v1's graded population). */
export const isGradeable = (p: PageResult): boolean =>
  p.kind === 'content' && p.status_code === 200;

export const byKey = (a: Detection, b: Detection): number =>
  byText(a.type, b.type) || byText(a.key, b.key);
