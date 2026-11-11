/**
 * Crawl rows and batch results for the stream's tests, made from the first row of the engine's
 * recorded build fixture so each is a contract `CrawlPage` with the fields a test names changed.
 */
import type { CrawlBatchResult, CrawlPage, LinkEdge } from '@crawlmouse/types/v2';
import { readRecorded } from '../../../../../packages/engine/fixtures/v2/build/recorded';

const RECORDED = readRecorded('batches').find((b): b is CrawlBatchResult => b.kind === 'crawl')!;
const ROW = RECORDED.pages[0]!;

export const ORIGIN = 'https://stream.test';
/** The check's start in these fixtures; a row's `at` is milliseconds after it. */
export const STARTED = Date.parse('2026-11-10T10:00:00.000Z');

export interface RowSpec {
  path: string;
  at: number;
  status?: number | null;
  ms?: number | null;
  links?: number | null;
  outcome?: CrawlPage['outcome'];
  /** Characters of served text the row carries. */
  text?: number;
}

export const urlOf = (path: string): string => `${ORIGIN}${path}`;

export function row(spec: RowSpec): CrawlPage {
  const { status = 200, ms = 120, links = 3 } = spec;
  return {
    ...ROW,
    url: urlOf(spec.path),
    final_url: urlOf(spec.path),
    outcome: spec.outcome ?? 'fetched',
    fetched_at: new Date(STARTED + spec.at).toISOString(),
    status_code: status,
    links_out: links,
    timing: ms === null ? null : { dns_ms: null, connect_ms: null, ttfb_ms: null, total_ms: ms },
    raw_text: spec.text === undefined ? ROW.raw_text : 'x'.repeat(spec.text),
  };
}

export const edge = (from: string, to: string, js = false): LinkEdge => ({
  check_id: ROW.check_id,
  from_url: urlOf(from),
  to_url: urlOf(to),
  anchor_text: 'a link',
  is_generic_anchor: false,
  js_only: js,
});

/** A contract crawl batch result holding `pages` and `link_edges`. */
export function crawlResult(pages: CrawlPage[], link_edges: LinkEdge[]): CrawlBatchResult {
  return { ...RECORDED, pages, link_edges, discovered_urls: [] };
}
