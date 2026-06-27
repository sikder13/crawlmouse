import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { crawlAndPersist, setCrawlHealthReporter } from './audit';

// Task 11 / SPEC 01 §10 observability. crawlAndPersist must, on a v2 audit, hand the per-audit
// crawl-health to an INJECTED reporter (mirroring the Sentry audit-failure seam) so the worker
// package stays observability-agnostic. Two hard contracts:
//   - v2-GATED: it fires ONLY when the crawl result carries crawlHealth (i.e. ENGINE_V2 on). A v1
//     result has no crawlHealth, so the reporter is never called → ZERO new emits on the v1 path.
//   - BEST-EFFORT: a reporter error never breaks an audit (telemetry is not load-bearing).
const crawlHealth = {
  discovered: 120,
  fetchedOk: 100,
  blocked: 15,
  dead: 5,
  attempted: 120,
  coveragePct: 0.83,
  blockRate: 0.125,
  partial: true,
  confidence: 'low' as const,
};

function result(over: Record<string, unknown> = {}) {
  return {
    url: 'https://x.com',
    cms: 'custom',
    cmsConfidence: 1,
    cmsMetadata: {},
    grade: 'B',
    score: 80,
    breakdown: { orphanRatioScore: 1, depthScore: 1, anchorDiversityScore: 1, structureScore: 1 },
    startedAt: new Date(),
    completedAt: new Date(),
    pages: [{ url: 'https://x.com', urlHash: 'h', statusCode: 200, depth: 0, inDegree: 0, outDegree: 1, isOrphan: false }],
    links: [],
    findings: [],
    crawlHealth,
    ...over,
  };
}

describe('crawlAndPersist crawl-health observability (Task 11 / §10) — v2-gated, best-effort', () => {
  // The reporter is a module-level singleton; reset to a no-op BEFORE and AFTER each test so no
  // test's outcome leaks into a sibling (mirrors the handleAuditFailure reporter tests).
  beforeEach(() => setCrawlHealthReporter(() => {}));
  afterEach(() => setCrawlHealthReporter(() => {}));

  it('reports crawl-health (auditId + url + crawlHealth) to the injected reporter on a v2 audit', async () => {
    const reporter = vi.fn();
    setCrawlHealthReporter(reporter);
    const runAudit = vi.fn(async () => result());
    const persistAuditResults = vi.fn(async () => {});
    await crawlAndPersist(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      { auditId: 'aud-1', url: 'https://x.com', pageCap: 500 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { runAudit: runAudit as any, persistAuditResults: persistAuditResults as any },
    );
    expect(reporter).toHaveBeenCalledTimes(1);
    expect(reporter).toHaveBeenCalledWith({ auditId: 'aud-1', url: 'https://x.com', crawlHealth });
  });

  it('does NOT report on a v1 audit (no crawlHealth) — zero new emits on the v1 path', async () => {
    const reporter = vi.fn();
    setCrawlHealthReporter(reporter);
    const runAudit = vi.fn(async () => result({ crawlHealth: undefined }));
    const persistAuditResults = vi.fn(async () => {});
    await crawlAndPersist(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      { auditId: 'aud-2', url: 'https://x.com' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { runAudit: runAudit as any, persistAuditResults: persistAuditResults as any },
    );
    expect(reporter).not.toHaveBeenCalled();
  });

  it('reports AFTER a successful persist (telemetry never precedes the durable write)', async () => {
    const order: string[] = [];
    setCrawlHealthReporter(() => order.push('report'));
    const runAudit = vi.fn(async () => result());
    const persistAuditResults = vi.fn(async () => {
      order.push('persist');
    });
    await crawlAndPersist(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      { auditId: 'a', url: 'https://x.com' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { runAudit: runAudit as any, persistAuditResults: persistAuditResults as any },
    );
    expect(order).toEqual(['persist', 'report']);
  });

  it('does NOT report when persistence fails (no completion → no crawl-health emit)', async () => {
    const reporter = vi.fn();
    setCrawlHealthReporter(reporter);
    const runAudit = vi.fn(async () => result());
    const persistAuditResults = vi.fn(async () => {
      throw new Error('db down');
    });
    await crawlAndPersist(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      { auditId: 'a', url: 'https://x.com' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { runAudit: runAudit as any, persistAuditResults: persistAuditResults as any },
    ).catch(() => {});
    expect(reporter).not.toHaveBeenCalled();
  });

  it('is best-effort: a throwing reporter never breaks the audit (the summary still returns)', async () => {
    setCrawlHealthReporter(() => {
      throw new Error('telemetry backend down');
    });
    const runAudit = vi.fn(async () => result());
    const persistAuditResults = vi.fn(async () => {});
    const summary = await crawlAndPersist(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      { auditId: 'aud-9', url: 'https://x.com' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { runAudit: runAudit as any, persistAuditResults: persistAuditResults as any },
    );
    expect(summary).toEqual({ auditId: 'aud-9', grade: 'B', score: 80, pages: 1 });
  });
});
