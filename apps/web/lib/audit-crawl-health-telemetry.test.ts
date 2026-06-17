import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the app's Sentry client (mirrors audit-failure-sentry.test.ts). We only need the two
// surfaces the crawl-health reporter uses: breadcrumb trail + a gated degraded capture.
const addBreadcrumb = vi.fn();
const captureMessage = vi.fn();
vi.mock('@sentry/nextjs', () => ({
  addBreadcrumb: (...args: unknown[]) => addBreadcrumb(...args),
  captureMessage: (...args: unknown[]) => captureMessage(...args),
}));

import { sentryCrawlHealthReporter } from './audit-crawl-health-telemetry';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const health = (o: Record<string, unknown> = {}): any => ({
  discovered: 100,
  fetchedOk: 95,
  blocked: 3,
  dead: 2,
  attempted: 100,
  coveragePct: 0.95,
  blockRate: 0.03,
  partial: false,
  confidence: 'high',
  ...o,
});

describe('sentryCrawlHealthReporter (§10 crawl-health breadcrumbs + a gated degraded signal)', () => {
  beforeEach(() => {
    addBreadcrumb.mockClear();
    captureMessage.mockClear();
  });

  it('ALWAYS adds a crawl-health breadcrumb carrying the fetch-outcome counts', () => {
    sentryCrawlHealthReporter({ auditId: 'aud-1', url: 'https://x.com', crawlHealth: health() });
    expect(addBreadcrumb).toHaveBeenCalledTimes(1);
    const bc = addBreadcrumb.mock.calls[0]![0] as { category: string; data: Record<string, unknown> };
    expect(bc.category).toBe('crawl-health');
    expect(bc.data).toMatchObject({
      auditId: 'aud-1',
      blocked: 3,
      dead: 2,
      partial: false,
      confidence: 'high',
      blockRate: 0.03,
      coveragePct: 0.95,
    });
  });

  it('does NOT capture a degraded message for a healthy, high-confidence, non-partial crawl (breadcrumb only)', () => {
    sentryCrawlHealthReporter({ auditId: 'a', url: 'https://x.com', crawlHealth: health() });
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('captures signal=crawl-degraded (warning) when the crawl was budget-exhausted (partial)', () => {
    sentryCrawlHealthReporter({ auditId: 'a', url: 'https://x.com', crawlHealth: health({ partial: true }) });
    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [msg, opts] = captureMessage.mock.calls[0] as [string, Record<string, unknown>];
    expect(msg).toBe('crawl.degraded');
    expect(opts.level).toBe('warning');
    expect(opts.tags).toEqual({ signal: 'crawl-degraded' });
  });

  it('captures signal=crawl-degraded when confidence is low (heavily blocked / poorly reached)', () => {
    sentryCrawlHealthReporter({
      auditId: 'a',
      url: 'https://x.com',
      crawlHealth: health({ confidence: 'low', blockRate: 0.4 }),
    });
    expect(captureMessage).toHaveBeenCalledTimes(1);
    const opts = captureMessage.mock.calls[0]![1] as Record<string, unknown>;
    expect(opts.tags).toEqual({ signal: 'crawl-degraded' });
  });

  it('uses a tag DISTINCT from audit-failed so the existing alert rule is untouched', () => {
    sentryCrawlHealthReporter({ auditId: 'a', url: 'https://x.com', crawlHealth: health({ partial: true }) });
    const opts = captureMessage.mock.calls[0]![1] as { tags: { signal: string } };
    expect(opts.tags.signal).not.toBe('audit-failed');
    expect(opts.tags.signal).toBe('crawl-degraded');
  });

  it('bounds the user-supplied URL before it reaches the error subprocessor (breadcrumb + capture)', () => {
    const long = 'https://x.com/' + 'a'.repeat(5000);
    sentryCrawlHealthReporter({ auditId: 'a', url: long, crawlHealth: health({ partial: true }) });
    const bc = addBreadcrumb.mock.calls[0]![0] as { data: { url: string } };
    const cap = captureMessage.mock.calls[0]![1] as { extra: { url: string } };
    expect(bc.data.url.length).toBeLessThanOrEqual(200);
    expect(cap.extra.url.length).toBeLessThanOrEqual(200);
  });
});
