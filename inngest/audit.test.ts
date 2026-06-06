import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { crawlAndPersist } from './audit';

// A realistic large crawl result: ~600 pages / 700 links / 40 findings. Serialized whole,
// this is the multi-MiB object that previously crossed the run-engine -> persist-results
// step boundary and tripped Inngest's step-output size limit on big sites (the MAJOR
// finding from handoff010). crawlAndPersist must keep it INSIDE the step and return only
// a tiny summary.
const BIG_RESULT = {
  url: 'https://x.com',
  cms: 'custom',
  cmsConfidence: 1,
  cmsMetadata: {},
  grade: 'B+',
  score: 82,
  breakdown: { orphanRatioScore: 1, depthScore: 1, anchorDiversityScore: 1, structureScore: 1 },
  startedAt: new Date(),
  completedAt: new Date(),
  pages: Array.from({ length: 600 }, (_, i) => ({
    url: `https://x.com/p${i}`, urlHash: `h${i}`, statusCode: 200, depth: 1, inDegree: 1, outDegree: 1, isOrphan: false,
  })),
  links: Array.from({ length: 700 }, (_, i) => ({
    fromUrl: 'https://x.com', toUrl: `https://x.com/p${i % 600}`, anchorText: 'x', isGenericAnchor: false,
  })),
  findings: Array.from({ length: 40 }, (_, i) => ({ category: 'orphan', severity: 'critical', pageUrl: `https://x.com/p${i}` })),
};

describe('crawlAndPersist (A2: the big crawl result never crosses an Inngest step boundary)', () => {
  it('returns ONLY a small summary and keeps the page/link/finding arrays inside the step', async () => {
    const order: string[] = [];
    const runAudit = vi.fn(async () => {
      order.push('crawl');
      return BIG_RESULT;
    });
    const persistAuditResults = vi.fn(async () => {
      order.push('persist');
    });
    const sb = { __sentinel: true };

    const summary = await crawlAndPersist(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sb as any,
      { auditId: 'aud-1', url: 'https://x.com', pageCap: 500 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { runAudit: runAudit as any, persistAuditResults: persistAuditResults as any },
    );

    // Crawl runs, THEN persistence runs with the FULL result and the right ids — the big
    // object is handed to persistence inside the step, not returned across the boundary.
    expect(order).toEqual(['crawl', 'persist']);
    expect(persistAuditResults).toHaveBeenCalledWith(sb, 'aud-1', BIG_RESULT);
    expect(runAudit).toHaveBeenCalledTimes(1);

    // The RETURN VALUE is exactly what Inngest serializes as the step output and
    // size-limits. It must be the tiny summary, never the multi-MiB crawl result.
    expect(summary).toEqual({ auditId: 'aud-1', grade: 'B+', score: 82, pages: 600 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(Array.isArray((summary as any).pages)).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((summary as any).links).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((summary as any).findings).toBeUndefined();
    // Hard size sanity: the failure mode was a ~2-6 MiB step output; the summary is tiny.
    expect(JSON.stringify(summary).length).toBeLessThan(500);
  });

  it('applies safe defaults and forwards every crawl option (incl. v1.2 context)', async () => {
    const runAudit = vi.fn(async (_opts: unknown) => BIG_RESULT);
    const persistAuditResults = vi.fn(async () => {});
    await crawlAndPersist(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      {
        auditId: 'a',
        url: 'https://x.com',
        perHostConcurrency: 4,
        basicAuth: { username: 'u', password: 'p' },
        extraHeaders: { 'x-staging': '1' },
        commitSha: 'abc123',
        environment: 'staging',
        branch: 'feat/x',
        deploymentId: 'dep_1',
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { runAudit: runAudit as any, persistAuditResults: persistAuditResults as any },
    );
    const opts = runAudit.mock.calls[0]![0] as Record<string, unknown>;
    // defaults
    expect(opts.pageCap).toBe(500);
    expect(opts.staggerMs).toBe(250);
    expect(opts.pageTimeoutMs).toBe(10000);
    // forwarded
    expect(opts.url).toBe('https://x.com');
    expect(opts.perHostConcurrency).toBe(4);
    expect(opts.basicAuth).toEqual({ username: 'u', password: 'p' });
    expect(opts.extraHeaders).toEqual({ 'x-staging': '1' });
    expect(opts.commitSha).toBe('abc123');
    expect(opts.environment).toBe('staging');
    expect(opts.branch).toBe('feat/x');
    expect(opts.deploymentId).toBe('dep_1');
  });
});

// The original A2 bug lived in auditFn's STEP WIRING (two steps: run-engine returned the
// multi-MiB result, then persist-results consumed it across the boundary). The helper tests
// above prove crawlAndPersist returns a tiny summary, but nothing else stops a future edit
// from re-splitting auditFn back into a step that returns the big object. tsc cannot express
// "exactly one step, returning a small value", so — following this repo's load-harness-guard
// pattern — we assert the step structure against the source text. (Deterministic, no network.)
describe('auditFn step structure (A2 regression guard)', () => {
  const src = readFileSync(new URL('./audit.ts', import.meta.url), 'utf8');

  it('crawls and persists in exactly one step that delegates to crawlAndPersist', () => {
    // Require the trailing comma so a prose/JSDoc mention of step.run('crawl-and-persist')
    // isn't counted as a call.
    const crawlPersistSteps = src.match(/step\.run\(\s*['"]crawl-and-persist['"]\s*,/g) ?? [];
    expect(crawlPersistSteps).toHaveLength(1);
    expect(src).toMatch(/step\.run\(\s*['"]crawl-and-persist['"]\s*,\s*\(\)\s*=>\s*crawlAndPersist\(/);
  });

  it('does NOT reintroduce the separate run-engine / persist-results steps', () => {
    expect(src).not.toMatch(/step\.run\(\s*['"]run-engine['"]/);
    expect(src).not.toMatch(/step\.run\(\s*['"]persist-results['"]/);
  });
});
