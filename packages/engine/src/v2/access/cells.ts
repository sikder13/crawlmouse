/**
 * The cells of the matrix: each crawler's verdict on each page, before anything is added up.
 *
 * For a crawler the worker requests as, a cell is its row on a sampled page, as the worker wrote it.
 * The sampled pages are those any crawler has a row on, and each testable crawler must have one row
 * on each: the worker writes them all, so a missing or doubled row is refused rather than guessed
 * at. So is a row whose cause or evidence class is one the worker's table never gives its verdict
 * (CAUSES, EVIDENCE below). The control's and the canary's rows (`ua` null) are the worker's method,
 * not a crawler's result, and are not read.
 *
 * For a search engine, which is never requested as, a cell is what robots.txt says to it about a
 * crawled page (`PageResult.robots_search`).
 */
import type {
  AccessCause,
  AccessTest,
  CrawlerRegistryEntry,
  EvidenceClass,
  Verdict,
} from '@crawlmouse/types/v2';
import { byText } from '../detectors/scope.js';
import type { AccessInput, Cell } from './types.js';

/** The causes the worker's decision table gives each verdict (`packages/worker/src/verdict/table.ts`). */
export const CAUSES: Readonly<Record<Verdict, readonly (AccessCause | null)[]>> = {
  allowed: [null],
  allowed_thin: [null],
  disallowed_by_robots: ['robots_txt_disallow'],
  blocked_by_ua_rule: [null, 'cloudflare_1020'],
  refused_unverified: [null, 'cloudflare_1020'],
  challenged_ua: ['automation_challenge'],
  rate_limited: ['rate_limit_429'],
  payment_required: ['pay_per_crawl_402'],
  redirected_away: ['cross_host_redirect'],
  edge_blocks_automation: [null, 'cloudflare_1020', 'automation_challenge'],
  not_measured: [null],
};

/**
 * The evidence class each verdict rests on in the worker's table. `observed` (owner logs, CC-36b) is
 * not read here yet.
 */
export const EVIDENCE: Readonly<Record<Verdict, readonly EvidenceClass[]>> = {
  allowed: ['simulated'],
  allowed_thin: ['simulated'],
  disallowed_by_robots: ['declared'],
  blocked_by_ua_rule: ['simulated'],
  refused_unverified: ['simulated'],
  challenged_ua: ['simulated'],
  rate_limited: ['simulated'],
  payment_required: ['simulated'],
  redirected_away: ['simulated'],
  edge_blocks_automation: ['simulated'],
  not_measured: ['declared', 'simulated'],
};

const fail = (why: string): never => {
  throw new Error(`access detectors: ${why}`);
};

function checked(t: AccessTest): AccessTest {
  const at = `${t.ua}'s row on ${t.page_url}`;
  if (!CAUSES[t.verdict].includes(t.cause))
    fail(`${at} names ${t.cause ?? 'no cause'} as the cause of ${t.verdict}`);
  if (!EVIDENCE[t.verdict].includes(t.evidence_class))
    fail(`${at} rests ${t.verdict} on ${t.evidence_class} evidence`);
  return t;
}

function workerCells(input: AccessInput, testable: ReadonlySet<string>): Map<string, Cell[]> {
  const by = new Map<string, Map<string, Cell>>([...testable].map((t) => [t, new Map()]));
  const sampled = new Set<string>();
  for (const row of input.access_tests) {
    if (row.ua === null) continue;
    const cells = by.get(row.ua) ?? fail(`${row.ua} is not a crawler the worker requests as`);
    if (cells.has(row.page_url)) fail(`the rows list ${row.ua} on ${row.page_url} twice`);
    const t = checked(row);
    sampled.add(t.page_url);
    cells.set(t.page_url, {
      id: t.id,
      page_url: t.page_url,
      template_key: t.template_key,
      verdict: t.verdict,
      cause: t.cause,
      status: t.raw_status,
      evidence_class: t.evidence_class,
      headers: t.headers,
    });
  }
  for (const [ua, cells] of by)
    for (const url of sampled) if (!cells.has(url)) fail(`there is no row for ${ua} on ${url}`);
  return new Map([...by].map(([ua, cells]) => [ua, [...cells.values()]]));
}

function searchCells(input: AccessInput, ua: string): Cell[] {
  return input.pages.map((p) => {
    const verdict = p.robots_search.find((r) => r.ua === ua)?.verdict ?? 'not_measured';
    return {
      id: null,
      page_url: p.url,
      template_key: p.template_key,
      verdict,
      cause: verdict === 'disallowed_by_robots' ? 'robots_txt_disallow' : null,
      status: null,
      evidence_class: 'declared',
      headers: [],
    };
  });
}

/** Refuses the page list the contract does not allow: a URL twice, or a reading for an unknown engine. */
function checkPages(input: AccessInput, search: ReadonlySet<string>): void {
  const seen = new Set<string>();
  for (const p of input.pages) {
    if (seen.has(p.url)) fail(`the pages list ${p.url} twice`);
    seen.add(p.url);
    for (const r of p.robots_search)
      if (!search.has(r.ua))
        fail(`${p.url} has a robots.txt reading for ${r.ua}, not a search engine`);
  }
}

/** Every registry crawler's cells, by token, each list sorted by page URL. */
export function cellsOf(
  input: AccessInput,
  registry: readonly CrawlerRegistryEntry[],
): Map<string, Cell[]> {
  for (const e of registry)
    if (!e.testable && e.group !== 'search_engine')
      fail(`${e.token} is neither requested as nor a search engine, so nothing measures it`);
  const testable = new Set(registry.filter((e) => e.testable).map((e) => e.token));
  checkPages(input, new Set(registry.filter((e) => !e.testable).map((e) => e.token)));
  const worker = workerCells(input, testable);
  return new Map(
    registry.map((e) => {
      const cells = e.testable ? worker.get(e.token)! : searchCells(input, e.token);
      return [e.token, [...cells].sort((a, b) => byText(a.page_url, b.page_url))];
    }),
  );
}
