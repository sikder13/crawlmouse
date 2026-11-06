import { describe, expect, it } from 'vitest';
import { BatchResultSchema, type CrawlBatchResult } from './worker-batch.js';

const CHECK = '00000000-0000-4000-8000-0000000000c4';

const page = {
  check_id: CHECK,
  url: 'https://a.test/',
  outcome: 'fetched',
  response: 'served',
  evidence_class: 'simulated',
  identity_sent: 'Crawlmouse/2.0',
  source_ip_class: 'fly_egress',
  limitations: [],
  fetched_at: '2026-11-05T10:00:00Z',
  request_headers: [],
  status_code: 200,
  final_url: 'https://a.test/',
  headers: [],
  byte_count: 100,
  word_count: 10,
  raw_text: 'hello',
  canonical_url: null,
  links_out: 0,
  redirect: { hops: [], loop: false },
  canonical_declared: null,
  hreflang: null,
  content_simhash: null,
  is_html: true,
  links_read: true,
  robots_search: [{ ua: 'Googlebot', verdict: 'allowed' }],
  title: { text: 't', chars: 1, cut: false },
  meta_description: null,
  fly_region: null,
  request_signing: 'unsigned',
  signature_verified: 'not_observable',
  worker_release: 'unreleased',
  timing: { dns_ms: null, connect_ms: null, ttfb_ms: 5, total_ms: 9 },
  content_features: null,
  stack_signals: { cms: 'custom', detected_from: 'HTML and response headers' },
  main_text_chars: 120,
  noindex: false,
};

const robots = {
  origin: 'https://a.test',
  identity_sent: 'Crawlmouse/2.0',
  state: 'rules',
  why: null,
  status: 200,
  final_url: 'https://a.test/robots.txt',
  fetched_at: '2026-11-05T10:00:00Z',
  from_cache: false,
  crawl_delay_s: null,
  body_excerpt: 'User-agent: *',
  body: 'User-agent: *',
  body_complete: true,
};

const crawl = {
  batch_id: `${CHECK}:0`,
  check_id: CHECK,
  site_id: '00000000-0000-4000-8000-0000000000a4',
  started_at: '2026-11-05T10:00:00Z',
  finished_at: '2026-11-05T10:00:05Z',
  requests: 2,
  bytes: 200,
  coverage: { urls_requested: 1, urls_complete: 1 },
  partial: null,
  findings: [{ kind: 'budget_spent', budget: 'requests' }],
  robots: [robots],
  declarations: [],
  kind: 'crawl',
  pages: [page],
  link_edges: [],
  discovered_urls: [],
} as const;

/** A copy of the valid result with one unnamed field added to the object `at` returns. */
function withExtra(at: (r: CrawlBatchResult) => object): unknown {
  const r = BatchResultSchema.parse(structuredClone(crawl)) as CrawlBatchResult;
  Object.assign(at(r), { not_in_the_contract: 1 });
  return r;
}

describe('BatchResultSchema', () => {
  it('parses a crawl result built to the contract', () => {
    expect(BatchResultSchema.safeParse(crawl).success).toBe(true);
  });

  it.each([
    ['the result', (r: CrawlBatchResult) => r],
    ['its coverage', (r: CrawlBatchResult) => r.coverage],
    ['a crawl row', (r: CrawlBatchResult) => r.pages[0]!],
    ['a finding', (r: CrawlBatchResult) => r.findings[0]!],
    ['a robots reading', (r: CrawlBatchResult) => r.robots[0]!],
  ])('refuses a field the contract does not name on %s', (_, at) => {
    expect(BatchResultSchema.safeParse(withExtra(at)).success).toBe(false);
  });

  it('refuses a result of neither kind', () => {
    expect(BatchResultSchema.safeParse({ ...crawl, kind: 'render' }).success).toBe(false);
  });
});
