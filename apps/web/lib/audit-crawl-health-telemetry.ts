import * as Sentry from '@sentry/nextjs';
import type { CrawlHealth } from '@crawlmouse/types';

/** Bound the user-supplied audited URL before it reaches the error subprocessor (operator telemetry). */
const MAX_URL = 200;

/**
 * SPEC 01 §10 per-audit crawl-health observability. Mirrors the `audit-failed` reporter: the worker
 * package stays Sentry-agnostic and calls this via the injected `setCrawlHealthReporter` seam (wired
 * in the Inngest serve route). Two surfaces:
 *  - a `crawl-health` BREADCRUMB on every v2 audit (context for any event captured in the same scope), and
 *  - a low-noise `crawl.degraded` CAPTURE — tagged `signal: crawl-degraded`, DISTINCT from the
 *    `audit-failed` alert — only when the crawl was budget-exhausted (`partial`) or untrustworthy
 *    (`confidence === 'low'`), so a degraded-but-completed crawl is actually visible in Sentry.
 *
 * The worker gates this on `result.crawlHealth`, so it fires only for v2 audits — the v1 path (prod
 * until the ENGINE_V2 flip) emits nothing new. Never throws: the worker calls it best-effort.
 */
export function sentryCrawlHealthReporter({
  auditId,
  url,
  crawlHealth,
}: {
  auditId: string;
  url: string;
  crawlHealth: CrawlHealth;
}): void {
  const safeUrl = url.slice(0, MAX_URL);
  const { blocked, dead, partial, confidence, blockRate, coveragePct, fetchedOk, discovered } = crawlHealth;

  Sentry.addBreadcrumb({
    category: 'crawl-health',
    level: 'info',
    message: 'crawl-health',
    data: { auditId, url: safeUrl, blocked, dead, partial, confidence, blockRate, coveragePct, fetchedOk, discovered },
  });

  // A pure breadcrumb never surfaces on the success path (nothing gets captured), so for a genuinely
  // degraded crawl we ALSO emit a low-noise message — a new `signal` tag that operators can query /
  // alert on independently of (and without touching) the `audit-failed` rule.
  if (partial || confidence === 'low') {
    Sentry.captureMessage('crawl.degraded', {
      level: 'warning',
      tags: { signal: 'crawl-degraded' },
      extra: { auditId, url: safeUrl, blocked, dead, partial, confidence, blockRate, coveragePct },
    });
  }
}
