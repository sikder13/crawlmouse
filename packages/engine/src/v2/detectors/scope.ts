/**
 * What the structure detectors need to know about the crawl before judging anything: which pages it
 * holds, which links those pages carry, and whether the crawl saw enough to prove that something is
 * absent.
 */
import type { LinkEdge, PageResult } from '@crawlmouse/types/v2';
import { canonicalizeUrl } from '../../url-canonical.js';
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

const isGone = (status: number): boolean => GONE_STATUSES.some((s) => s === status);
const isRedirect = (status: number): boolean => status >= 300 && status < 400;

/**
 * An answer that kept the page's content from our crawler: anything but a 200, a redirect, a 404 or
 * a 410. A 401, 403 or 429 can be a rule against our crawler alone and a 5xx can pass on a retry, so
 * the page's links and content are unknown, not absent. A redirect has no content of its own, and a
 * gone page is no longer part of the site.
 */
export const isUnread = (status: number): boolean =>
  status !== 200 && !isRedirect(status) && !isGone(status);

export interface Scope {
  input: DetectorInput;
  /** Every crawled page, by URL. */
  page: ReadonlyMap<string, PageResult>;
  /** Every page's facts, by URL, with their URLs canonicalised (`canonicalFacts`). */
  facts: ReadonlyMap<string, PageFacts>;
  /** Crawled pages that answered 200, sorted. */
  ok: readonly string[];
  /**
   * Links from crawled 200 pages, by source and by target, each sorted. A link recorded from or to a
   * page's final URL (`PageFacts.final_url`, when no other page has it) is filed under the requested
   * URL, the one PageResult carries: the worker records a redirected page's links from where it landed.
   */
  out: ReadonlyMap<string, readonly LinkEdge[]>;
  in: ReadonlyMap<string, readonly LinkEdge[]>;
  /** A URL as the scope files it: the requested URL for a final URL that names one page. */
  resolve: (url: string) => string;
  /** Link targets of crawled 200 pages that were not crawled themselves, sorted. */
  uncrawledTargets: readonly string[];
  /** The crawl was cut short: the page cap, a partial check, or coverage under MIN_CRAWL_COVERAGE. */
  truncated: boolean;
  /**
   * The crawl discovered URLs it did not fetch: Coverage counts more discovered than crawled, or a
   * crawled page links to a URL that was not crawled. A URL robots.txt kept our crawler from is not
   * exempt: the rules can single out our crawler while search engines read the page.
   */
  unfetched: boolean;
  /**
   * Links the crawl reached but did not see: a crawled 200 page found more links than were recorded,
   * or recorded none and its links are not known to have been read (`PageFacts.links_read`), or a
   * crawled page answered a status that kept its content from us (`isUnread`).
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

/** A URL in the engine's spelling; one that does not parse is kept as written and matches nothing. */
function spell(url: string): string {
  try {
    return canonicalizeUrl(url);
  } catch {
    return url;
  }
}

/**
 * A page's facts with every URL in them in the spelling links and pages use. The worker stores where
 * a request ended as the server wrote it, so `/c/` against a page's `/c` would read as a redirect.
 */
function canonicalFacts(f: PageFacts): PageFacts {
  return {
    ...f,
    final_url: f.final_url === null ? null : spell(f.final_url),
    canonical:
      f.canonical === null
        ? null
        : { href: f.canonical.href === null ? null : spell(f.canonical.href) },
    hreflang: f.hreflang === null ? null : f.hreflang.map((l) => ({ ...l, href: spell(l.href) })),
  };
}

/**
 * The requested URL of each crawled 200 page that landed somewhere else, by where it landed. A final
 * URL two pages share, or one that is itself a crawled page, is left out: it names no single page.
 */
function landings(page: ReadonlyMap<string, PageResult>, facts: readonly PageFacts[]) {
  const by = new Map<string, string | null>();
  for (const f of facts) {
    const landed = f.final_url;
    if (landed === null || landed === f.url || page.has(landed)) continue;
    if (page.get(f.url)?.status_code !== 200) continue;
    by.set(landed, by.has(landed) ? null : f.url);
  }
  return by;
}

export function scopeOf(input: DetectorInput): Scope {
  const page = indexBy(input.pages, 'pages');
  const spelled = input.facts.map(canonicalFacts);
  const facts = indexBy(spelled, 'facts');
  const ok = sorted(input.pages.filter((p) => p.status_code === 200).map((p) => p.url));
  const okSet = new Set(ok);
  const landed = landings(page, spelled);
  const resolve = (url: string) => landed.get(url) ?? url;
  // Edges as recorded, in a stable order, so that when two resolve to one link the first is kept
  // whatever order they arrived in. `recorded` counts them before that merge, to compare with the
  // page's own count of the links it found.
  const raw = [...input.edges].sort(
    (a, b) => byText(a.from_url, b.from_url) || byText(a.to_url, b.to_url),
  );
  const out = new Map<string, LinkEdge[]>();
  const into = new Map<string, LinkEdge[]>();
  const recorded = new Map<string, number>();
  const seen = new Set<string>();
  for (const r of raw) {
    const e = { ...r, from_url: resolve(r.from_url), to_url: resolve(r.to_url) };
    if (!okSet.has(e.from_url)) continue;
    recorded.set(e.from_url, (recorded.get(e.from_url) ?? 0) + 1);
    const pair = `${e.from_url}\u0000${e.to_url}`;
    if (e.from_url === e.to_url || seen.has(pair)) continue;
    seen.add(pair);
    (out.get(e.from_url) ?? out.set(e.from_url, []).get(e.from_url)!).push(e);
    (into.get(e.to_url) ?? into.set(e.to_url, []).get(e.to_url)!).push(e);
  }
  for (const list of out.values()) list.sort((a, b) => byText(a.to_url, b.to_url));
  for (const list of into.values()) list.sort((a, b) => byText(a.from_url, b.from_url));
  const uncrawledTargets = sorted([...into.keys()].filter((url) => !page.has(url)));
  const c = input.check.coverage;
  const unfetched =
    (c !== null && c.pages_crawled < c.pages_discovered) || uncrawledTargets.length > 0;
  const linksIncomplete =
    ok.some((url) => {
      const n = recorded.get(url) ?? 0;
      return page.get(url)!.links_out > n || (n === 0 && facts.get(url)?.links_read !== true);
    }) || input.pages.some((p) => isUnread(p.status_code));
  return {
    input,
    page,
    facts,
    ok,
    out,
    in: into,
    resolve,
    uncrawledTargets,
    truncated: isTruncated(input),
    unfetched,
    linksIncomplete,
  };
}

/**
 * Why this crawl cannot prove that something is absent (no link to a page, no path, no other page of
 * a template, no other member of a cluster), or null when it can: it is not truncated, it fetched as
 * many URLs as it discovered and each link target it found, and `linksIncomplete` found no page
 * whose links were left unseen.
 */
export function absenceUnproven(s: Scope): IndeterminateReason | null {
  if (s.truncated) return 'crawl_truncated';
  if (s.unfetched) return 'urls_not_fetched';
  if (s.linksIncomplete) return 'links_not_fully_recorded';
  return null;
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
  [...s.input.pages]
    .sort((a, b) => byText(a.url, b.url))
    .flatMap((p) => {
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
