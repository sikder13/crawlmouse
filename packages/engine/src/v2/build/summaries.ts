/**
 * The small summary each pipeline step returns to Inngest (ARCH-2 §4.2: under 4 KB; the rows go to
 * Postgres inside the step). One per check phase, counts and enum values only: nothing a site wrote,
 * so the size does not grow with what a page holds. summaries.test.ts measures them on a check at
 * the page cap.
 */
import type { Check } from '@crawlmouse/types/v2';
import type { DiffResult } from '../diff/types.js';
import type { Assembled } from './assemble.js';
import type { Graded } from './grade.js';
import type { PhaseSummary } from './types.js';

export const SUMMARY_BYTES = 4096;

export function summariesOf(
  check: Check,
  assembled: Assembled,
  graded: Graded,
  diff: DiffResult,
  seeds: { sitemap: number },
  batches: { crawl: number; access: number },
  rendered: { rendered: number; not_rendered: number } | null,
): PhaseSummary[] {
  const home = assembled.pages.find((p) => p.url === assembled.homepage_url) ?? null;
  const ai = check.ai_readability!;
  const seo = check.technical_seo!;
  return [
    {
      phase: 'robots_and_sitemap',
      robots_txt:
        graded.robots_txt === null ? 'not_read' : graded.robots_txt === '' ? 'none' : 'read',
      sitemap_seeds: seeds.sitemap,
    },
    {
      phase: 'homepage',
      status: home?.status_code ?? null,
      cms: check.stack?.backend?.cms ?? null,
      client_rendered: assembled.homepage_client_rendered,
    },
    {
      phase: 'crawl',
      batches: batches.crawl,
      pages_crawled: assembled.pages.length,
      pages_discovered: assembled.coverage.pages_discovered,
      links: assembled.edges.length,
      partial_reasons: assembled.status.reasons,
    },
    {
      phase: 'crawler_tests',
      batches: batches.access,
      pages_sampled: assembled.coverage.pages_sampled,
      access_tests: assembled.access_tests.length,
      scored_crawlers_measured: graded.access.scored_measured,
    },
    {
      phase: 'without_js',
      rendered: rendered?.rendered ?? 0,
      not_rendered: rendered?.not_rendered ?? 0,
      site_text_share: check.without_js?.site_text_share ?? null,
    },
    {
      phase: 'grading',
      status: check.status,
      technical_seo: seo.score,
      ai_readability: ai.withheld ? null : ai.total,
      ai_readability_withheld: ai.withheld,
      fixes_written: diff.fixes.length,
      changes: diff.changes.length,
    },
  ];
}
