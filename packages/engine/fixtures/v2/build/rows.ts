/**
 * Valid worker rows for the build tests' generated checks: a crawl row, a crawl batch and an access
 * row, each parsed with the contract's schema, so a generated input fails on what a test varies and
 * not on a shape this file got wrong. The recorded fixture (recorded.ts) is the worker's own rows.
 */
import {
  AccessBatchResultSchema,
  AccessTestSchema,
  CrawlBatchResultSchema,
  CrawlPageSchema,
  type AccessBatchResult,
  type AccessTest,
  type CrawlBatchResult,
  type CrawlPage,
  type LinkEdge,
} from '@crawlmouse/types/v2';
import { templateKeyFor } from '../../../src/analysis/template-key.js';

export const CHECK = 'c0000000-0000-4000-8000-00000000b0c1';
export const SITE = 'c0000000-0000-4000-8000-00000000b0a1';
export const AT = '2026-11-05T03:00:00.000Z';

export interface RowShape {
  url: string;
  outcome: CrawlPage['outcome'];
  /** For `fetched`: the final status; a redirect is given by `final_url`. */
  status?: number;
  final_url?: string;
  links_out?: number;
  html?: boolean;
  response?: CrawlPage['response'];
}

export function crawlRow(s: RowShape): CrawlPage {
  const fetched = s.outcome === 'fetched';
  const html = fetched && (s.html ?? true) && s.status === 200;
  return CrawlPageSchema.parse({
    check_id: CHECK,
    url: s.url,
    outcome: s.outcome,
    response: fetched ? (s.response ?? (s.status === 200 ? 'served' : 'gone')) : null,
    evidence_class: s.outcome === 'robots_disallowed' ? 'declared' : 'simulated',
    identity_sent: 'Crawlmouse/2.0',
    source_ip_class: 'fly_egress',
    limitations: [],
    fetched_at: AT,
    request_headers: [],
    status_code: fetched ? (s.status ?? 200) : null,
    final_url: fetched ? (s.final_url ?? s.url) : null,
    headers: [],
    byte_count: fetched ? 100 : null,
    word_count: html ? 50 : null,
    raw_text: html ? 'text' : null,
    canonical_url: null,
    links_out: html ? (s.links_out ?? 0) : null,
    redirect:
      fetched && s.final_url && s.final_url !== s.url
        ? { hops: [{ from: s.url, status: 301, location: s.final_url }], loop: false }
        : fetched
          ? { hops: [], loop: false }
          : null,
    canonical_declared: null,
    hreflang: null,
    content_simhash: null,
    is_html: html,
    links_read: html,
    robots_search: [
      { ua: 'Googlebot', verdict: 'allowed' },
      { ua: 'Bingbot', verdict: 'allowed' },
    ],
    title: html ? { text: `Page ${s.url}`, chars: 10, cut: false } : null,
    meta_description: null,
    fly_region: null,
    request_signing: 'unsigned',
    signature_verified: 'not_observable',
    worker_release: 'unreleased',
    timing: fetched ? { dns_ms: null, connect_ms: null, ttfb_ms: 5, total_ms: 9 } : null,
    content_features: null,
    stack_signals: null,
    main_text_chars: html ? 500 : null,
    noindex: html ? false : null,
  });
}

export const edge = (from_url: string, to_url: string, anchor_text = 'a link'): LinkEdge => ({
  check_id: CHECK,
  from_url,
  to_url,
  anchor_text,
  is_generic_anchor: false,
  js_only: false,
});

export function crawlBatch(
  n: number,
  pages: CrawlPage[],
  link_edges: LinkEdge[] = [],
  discovered_urls: string[] = [],
  partial: CrawlBatchResult['partial'] = null,
): CrawlBatchResult {
  return CrawlBatchResultSchema.parse({
    batch_id: `${CHECK}:${n}`,
    check_id: CHECK,
    site_id: SITE,
    started_at: AT,
    finished_at: AT,
    requests: pages.length,
    bytes: 100 * pages.length,
    coverage: { urls_requested: pages.length, urls_complete: pages.length },
    partial,
    findings: [],
    robots: [],
    declarations: [],
    kind: 'crawl',
    pages,
    link_edges,
    discovered_urls,
  });
}

export function accessRow(
  id: number,
  page_url: string,
  ua: string | null,
  verdict: AccessTest['verdict'],
  role: AccessTest['identity_role'] = 'crawler',
): AccessTest {
  return AccessTestSchema.parse({
    id: `d0000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    check_id: CHECK,
    ua,
    page_url,
    template_key: templateKeyFor(page_url),
    tested_at: AT,
    verdict,
    evidence_class: 'simulated',
    identity_sent: ua ?? 'Mozilla/5.0',
    source_ip_class: 'other_egress',
    limitations: [],
    cause: null,
    request_headers: [],
    raw_status: 200,
    final_url: page_url,
    headers: [],
    byte_count: 100,
    word_count: 50,
    body_excerpt: null,
    method: 'GET',
    http_version: '1.1',
    identity_role: role,
    tagged: false,
    witness: null,
    fly_region: null,
    request_signing: 'unsigned',
    signature_verified: 'not_observable',
    worker_release: 'unreleased',
    timing: { dns_ms: null, connect_ms: null, ttfb_ms: 5, total_ms: 9 },
  });
}

export function accessBatch(n: number, access_tests: AccessTest[]): AccessBatchResult {
  return AccessBatchResultSchema.parse({
    batch_id: `${CHECK}:${n}`,
    check_id: CHECK,
    site_id: SITE,
    started_at: AT,
    finished_at: AT,
    requests: access_tests.length,
    bytes: 100 * access_tests.length,
    coverage: { urls_requested: access_tests.length, urls_complete: access_tests.length },
    partial: null,
    findings: [],
    robots: [],
    declarations: [],
    kind: 'access',
    access_tests,
  });
}
