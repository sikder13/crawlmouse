/**
 * Inputs for the access detectors' tests. Every AccessTest made here is parsed by the contract's
 * schema, so a test cannot hand the detectors a row the contract rejects. The JSON fixtures beside
 * this file are the worker's own rows (see generate.ts) or the staging smoke's.
 */
import { readFileSync } from 'node:fs';
import {
  AccessTestSchema,
  SearchRobotsSchema,
  type AccessCause,
  type AccessTest,
  type SearchRobots,
  type Verdict,
} from '@crawlmouse/types/v2';
import { CRAWLER_REGISTRY_V2 } from '../../../src/v2/crawler-registry.js';
import type { AccessInput } from '../../../src/v2/access/types.js';

export const HOST = 'https://a.test';
const CHECK_ID = 'c0000000-0000-4000-8000-0000000000c1';

export const u = (path: string): string => `${HOST}${path}`;

/** The crawlers the worker requests as, in registry order. */
export const TESTABLE: readonly string[] = CRAWLER_REGISTRY_V2.filter((e) => e.testable).map(
  (e) => e.token,
);
export const SEARCH: readonly string[] = CRAWLER_REGISTRY_V2.filter(
  (e) => e.group === 'search_engine',
).map((e) => e.token);

/** The status a worker row carries for each verdict when nothing says otherwise. */
const STATUS: Record<Verdict, number | null> = {
  allowed: 200,
  allowed_thin: 200,
  disallowed_by_robots: 200,
  blocked_by_ua_rule: 403,
  challenged_ua: 403,
  refused_unverified: 403,
  rate_limited: 429,
  payment_required: 402,
  edge_blocks_automation: 403,
  redirected_away: 302,
  not_measured: null,
};

export interface CellSpec {
  verdict: Verdict;
  cause?: AccessCause | null;
  status?: number | null;
  evidence?: AccessTest['evidence_class'];
  headers?: AccessTest['headers'];
}

let next = 0;
const id = () => `e0000000-0000-4000-8000-${String(++next).padStart(12, '0')}`;

/** One crawler's row on one page; `ua` null is a method row (the control or the canary). */
export function row(
  ua: string | null,
  path: string,
  spec: CellSpec | Verdict,
  template = templateOf(path),
): AccessTest {
  const s = typeof spec === 'string' ? { verdict: spec } : spec;
  const status = s.status === undefined ? STATUS[s.verdict] : s.status;
  const declared = s.verdict === 'disallowed_by_robots';
  return AccessTestSchema.parse({
    id: id(),
    check_id: CHECK_ID,
    ua,
    page_url: u(path),
    template_key: template,
    tested_at: '2026-11-03T12:00:00.000Z',
    verdict: s.verdict,
    evidence_class: s.evidence ?? (declared ? 'declared' : 'simulated'),
    identity_sent: `${ua ?? 'Mozilla/5.0'} Crawlmouse/2.0 (+https://crawlmouse.com/bot)`,
    source_ip_class: 'fly_egress',
    limitations: [],
    cause: s.cause === undefined ? (declared ? 'robots_txt_disallow' : null) : s.cause,
    request_headers: [],
    raw_status: status,
    final_url: status === null ? null : u(path),
    headers: s.headers ?? [],
    byte_count: null,
    word_count: null,
    body_excerpt: null,
    method: status === null ? null : 'GET',
    http_version: status === null ? null : '1.1',
  });
}

export const templateOf = (path: string): string =>
  path === '/' ? '/' : `/${path.split('/').filter(Boolean)[0]}/{slug}`;

/** What robots.txt says to every search engine: `verdict` for each. */
export const searchRobots = (verdict: Verdict = 'allowed'): SearchRobots =>
  SEARCH.map((ua) => ({ ua, verdict }));

export interface GridSpec {
  pages: readonly string[];
  /** Per crawler, one cell per page (in `pages` order); a crawler not listed is served on every page. */
  cells?: Readonly<Record<string, readonly (CellSpec | Verdict)[]>>;
  /** What robots.txt says to the search engines on each page; allowed by default. */
  search?: readonly SearchRobots[];
  disallowed?: AccessInput['disallowed'];
}

/** A check: a control row and one row per testable crawler on each page, and the crawled pages. */
export function grid(spec: GridSpec): AccessInput {
  const access_tests = spec.pages.flatMap((path, i) => [
    row(null, path, 'allowed'),
    ...TESTABLE.map((ua) => row(ua, path, spec.cells?.[ua]?.[i] ?? 'allowed')),
  ]);
  const pages = spec.pages.map((path, i) => ({
    url: u(path),
    template_key: templateOf(path),
    robots_search: spec.search?.[i] ?? searchRobots(),
  }));
  return { access_tests, pages, disallowed: spec.disallowed ?? [] };
}

/** The same cell for one crawler on every page. */
export const every = (n: number, cell: CellSpec | Verdict): (CellSpec | Verdict)[] =>
  Array.from({ length: n }, () => cell);

export interface AccessFixture {
  provenance: string;
  /** The crawled pages' robots.txt readings for the search engines, when the fixture has them. */
  pages?: AccessInput['pages'];
  access_tests: AccessTest[];
}

/** A JSON fixture from this directory as a check, every row parsed by the contract. */
export function fixtureInput(name: string): AccessInput {
  const raw = JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8')) as AccessFixture;
  return {
    access_tests: raw.access_tests.map((t) => AccessTestSchema.parse(t)),
    pages: (raw.pages ?? []).map((p) => ({
      url: p.url,
      template_key: p.template_key,
      robots_search: SearchRobotsSchema.parse(p.robots_search),
    })),
    disallowed: [],
  };
}
