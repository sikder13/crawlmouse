/**
 * The cells of the matrix: each crawler's verdict on each page, before anything is added up.
 *
 * For a crawler the worker requests as, a cell is its row on a sampled page, as the worker wrote it.
 * The sampled pages are those any crawler has a row on, and every such crawler must have one row on
 * each: the worker writes them all, so a missing or doubled row is an input the contract does not
 * allow, and refusing it is safer than guessing. The control's and the canary's rows (`ua` null) are
 * the worker's method, not a crawler's result, and are not read.
 *
 * For a search engine, which is never requested as, a cell is what robots.txt says to it about a
 * crawled page (`PageResult.robots_search`) or a URL robots.txt kept our crawler from (`disallowed`).
 */
import type { AccessInput, Cell } from './types.js';
import type { CrawlerRegistryEntry, SearchRobots } from '@crawlmouse/types/v2';
import { byText } from '../detectors/scope.js';

const fail = (why: string): never => {
  throw new Error(`access detectors: ${why}`);
};

function workerCells(input: AccessInput, testable: ReadonlySet<string>): Map<string, Cell[]> {
  const by = new Map<string, Map<string, Cell>>([...testable].map((t) => [t, new Map()]));
  const sampled = new Set<string>();
  for (const t of input.access_tests) {
    if (t.ua === null) continue;
    const cells = by.get(t.ua) ?? fail(`${t.ua} is not a crawler the worker requests as`);
    if (cells.has(t.page_url)) fail(`the rows list ${t.ua} on ${t.page_url} twice`);
    if (t.cause === 'robots_txt_disallow' && t.verdict !== 'disallowed_by_robots')
      fail(`${t.ua}'s row on ${t.page_url} names robots.txt as the cause of ${t.verdict}`);
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

const searchCell = (
  url: string,
  template_key: string | null,
  robots: SearchRobots,
  ua: string,
): Cell => {
  const verdict = robots.find((r) => r.ua === ua)?.verdict ?? 'not_measured';
  return {
    id: null,
    page_url: url,
    template_key,
    verdict,
    cause: verdict === 'disallowed_by_robots' ? 'robots_txt_disallow' : null,
    status: null,
    evidence_class: 'declared',
    headers: [],
  };
};

function searchCells(input: AccessInput, ua: string): Cell[] {
  const urls = [...input.pages.map((p) => p.url), ...input.disallowed.map((d) => d.url)];
  const dup = urls.find((url, i) => urls.indexOf(url) !== i);
  if (dup !== undefined) fail(`${dup} is listed twice among the crawled and disallowed URLs`);
  return [
    ...input.pages.map((p) => searchCell(p.url, p.template_key, p.robots_search, ua)),
    ...input.disallowed.map((d) => searchCell(d.url, null, d.robots_search, ua)),
  ];
}

/** Every registry crawler's cells, by token, each list sorted by page URL. */
export function cellsOf(
  input: AccessInput,
  registry: readonly CrawlerRegistryEntry[],
): Map<string, Cell[]> {
  const testable = new Set(registry.filter((e) => e.testable).map((e) => e.token));
  const worker = workerCells(input, testable);
  return new Map(
    registry.map((e) => {
      const cells = e.testable ? worker.get(e.token)! : searchCells(input, e.token);
      return [e.token, [...cells].sort((a, b) => byText(a.page_url, b.page_url))];
    }),
  );
}
