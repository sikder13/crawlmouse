import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { NonRetriableError } from 'inngest';
import {
  crawlAndPersist,
  auditConcurrencyLimit,
  ensureServerlessCrawleeMemoryHint,
  handleAuditFailure,
  setAuditFailureReporter,
} from './audit';

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

  it('wraps a crawl (runAudit) failure as a NonRetriableError so a deterministic timeout fails fast instead of retrying 5×', async () => {
    const runAudit = vi.fn(async () => { throw new Error('Crawl timed out after 240000ms (wall-clock budget)'); });
    const persistAuditResults = vi.fn(async () => {});
    const err = await crawlAndPersist(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      { auditId: 'a', url: 'https://slow.example' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { runAudit: runAudit as any, persistAuditResults: persistAuditResults as any },
    ).catch((e) => e);
    // Non-retryable → Inngest fails after the FIRST attempt (onFailure then marks it 'failed').
    expect(err).toBeInstanceOf(NonRetriableError);
    // The original reason is preserved so server-side failure-classification still buckets it as timeout.
    expect((err as Error).message).toBe('Crawl timed out after 240000ms (wall-clock budget)');
    // Persistence is never reached when the crawl itself failed.
    expect(persistAuditResults).not.toHaveBeenCalled();
  });

  it('leaves a TRANSIENT crawl failure (e.g. a homepage network blip) retryable — only the wall-clock timeout is non-retryable', async () => {
    const runAudit = vi.fn(async () => { throw new Error('connect ECONNRESET 1.2.3.4:443'); });
    const persistAuditResults = vi.fn(async () => {});
    const err = await crawlAndPersist(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      { auditId: 'a', url: 'https://blip.example' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { runAudit: runAudit as any, persistAuditResults: persistAuditResults as any },
    ).catch((e) => e);
    // Not wrapped → Inngest's single retry can recover a momentary blip (vs the 30-min hang the
    // wall-clock timeout caused, which IS non-retryable).
    expect(err).not.toBeInstanceOf(NonRetriableError);
    expect((err as Error).message).toBe('connect ECONNRESET 1.2.3.4:443');
    expect(persistAuditResults).not.toHaveBeenCalled();
  });

  it('does NOT wrap a PERSIST failure — a rare transient DB blip stays retryable', async () => {
    const runAudit = vi.fn(async () => BIG_RESULT);
    const persistAuditResults = vi.fn(async () => { throw new Error('db connection reset'); });
    const err = await crawlAndPersist(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      { auditId: 'a', url: 'https://x.com' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { runAudit: runAudit as any, persistAuditResults: persistAuditResults as any },
    ).catch((e) => e);
    expect(err).not.toBeInstanceOf(NonRetriableError);
    expect((err as Error).message).toBe('db connection reset');
  });
});

// The original A2 bug lived in auditFn's STEP WIRING (two steps: run-engine returned the
// multi-MiB result, then persist-results consumed it across the boundary). The helper tests
// above prove crawlAndPersist returns a tiny summary, but nothing else stops a future edit
// from re-splitting auditFn back into a step that returns the big object. tsc cannot express
// "exactly one step, returning a small value", so — following this repo's load-harness-guard
// pattern — we assert the step structure against the source text. (Deterministic, no network.)
// Inngest rejects the WHOLE app sync (no functions register, no audit ever runs) if a function's
// concurrency exceeds the account plan cap (Free = 5). The limit must therefore be plan-safe by
// default and tunable by env, never a hardcoded Pro-tier number.
describe('auditConcurrencyLimit (Inngest plan-cap safety)', () => {
  it('defaults to the Free-plan-safe 5 when the env var is unset', () => {
    expect(auditConcurrencyLimit({})).toBe(5);
  });

  it('uses an explicit positive integer (e.g. 50 on a paid plan)', () => {
    expect(auditConcurrencyLimit({ INNGEST_AUDIT_CONCURRENCY: '50' })).toBe(50);
    expect(auditConcurrencyLimit({ INNGEST_AUDIT_CONCURRENCY: '1' })).toBe(1);
  });

  it('falls back to 5 for non-numeric, empty, zero, negative, or fractional values', () => {
    for (const bad of ['', 'abc', '0', '-3', '5.5', 'NaN']) {
      expect(auditConcurrencyLimit({ INNGEST_AUDIT_CONCURRENCY: bad })).toBe(5);
    }
  });

  it('clamps a fat-finger value to the cost-model ceiling (100) so a typo cannot re-break app sync', () => {
    expect(auditConcurrencyLimit({ INNGEST_AUDIT_CONCURRENCY: '100' })).toBe(100);
    expect(auditConcurrencyLimit({ INNGEST_AUDIT_CONCURRENCY: '101' })).toBe(100);
    expect(auditConcurrencyLimit({ INNGEST_AUDIT_CONCURRENCY: '500' })).toBe(100);
    expect(auditConcurrencyLimit({ INNGEST_AUDIT_CONCURRENCY: '1000000' })).toBe(100);
  });
});

// Crawlee's autoscaler spawns `ps` to measure memory unless AWS_LAMBDA_FUNCTION_MEMORY_SIZE is set;
// `ps` is absent in the Vercel serverless runtime, so without this hint the crawl step throws
// `spawn ps ENOENT` and retries forever (audit stuck `crawling`). The hint must apply whenever the
// var is unset and never clobber a host-provided value.
describe('ensureServerlessCrawleeMemoryHint (Crawlee ps-ENOENT workaround)', () => {
  it('sets the Lambda memory hint when AWS_LAMBDA_FUNCTION_MEMORY_SIZE is unset', () => {
    const env: Record<string, string | undefined> = {};
    ensureServerlessCrawleeMemoryHint(env);
    expect(env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE).toBe('3008');
  });

  it('is NOT gated on VERCEL — applies even when VERCEL is unset (the gate no-opped in prod)', () => {
    // Regression lock: a VERCEL-gated version silently no-opped because Vercel does not expose
    // VERCEL to the function runtime, so the `ps` spawn returned. The hint must not depend on it.
    const env: Record<string, string | undefined> = { VERCEL: undefined };
    ensureServerlessCrawleeMemoryHint(env);
    expect(env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE).toBe('3008');
  });

  it('never overrides a value the host already provided (idempotent; e.g. real AWS Lambda)', () => {
    const env: Record<string, string | undefined> = { AWS_LAMBDA_FUNCTION_MEMORY_SIZE: '1024' };
    ensureServerlessCrawleeMemoryHint(env);
    expect(env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE).toBe('1024');
  });
});

describe('auditFn step structure (A2 regression guard)', () => {
  const src = readFileSync(new URL('./audit.ts', import.meta.url), 'utf8');

  it('drives the audit function concurrency from auditConcurrencyLimit(), not a hardcoded number', () => {
    // The bug: a hardcoded `concurrency: { limit: 50 }` exceeded the Inngest Free cap of 5 and
    // failed the prod app sync. Pin the dynamic source so a future edit cannot reintroduce a
    // hardcoded limit that silently breaks sync on a smaller plan.
    expect(src).toMatch(/concurrency:\s*\{\s*limit:\s*auditConcurrencyLimit\(\)\s*\}/);
    // Forbid a digit-literal concurrency in ANY Inngest form — bare `concurrency: 50`,
    // `concurrency: { limit: 50 }` (incl. extra keys), or array `concurrency: [{ limit: 50 }]` —
    // so a regression to a hardcoded plan-breaking number fails here, not silently at prod sync.
    // Does not match the `auditConcurrencyLimit()` call (no digit follows the optional `limit:`).
    expect(src).not.toMatch(/concurrency:\s*\[?\s*\{?\s*(limit:\s*)?\d/);
  });

  it('caps Inngest retries to 1 so a NonRetriable crawl failure fails fast (no 5× wall-clock retry storm)', () => {
    // Default Inngest retries (4 → 5 attempts) made a deterministically-slow site sit 'crawling'
    // ~30 min, re-running the 240s wall-clock timeout each attempt. Pin retries:1 so a regression
    // to the default can't reintroduce the retry storm.
    expect(src).toMatch(/retries:\s*1\b/);
  });

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

  it('onFailure DELEGATES to handleAuditFailure (so the failed-mark + audit-failed signal cannot go dark)', () => {
    // The unit tests call handleAuditFailure directly; nothing else stops a future edit from gutting
    // auditFn.onFailure to a no-op (which silently drops BOTH the failed-marking AND the alert signal
    // while every other test still passes). Pin the delegation against the source (comments stripped
    // so a commented-out call can't satisfy it).
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(
      /onFailure:\s*async\s*\(\s*\{\s*event\s*,\s*error\s*\}\s*\)\s*=>\s*\{[\s\S]*?handleAuditFailure\(\s*supabaseAdmin\(\)\s*,\s*event\s*,\s*error\s*\)/.test(code),
      'auditFn.onFailure must delegate to handleAuditFailure(supabaseAdmin(), event, error)',
    ).toBe(true);
  });
});

// onFailure is the single place an audit is marked `failed` (after Inngest retries are exhausted).
// It must ALSO emit an observability signal so a prod audit-failure spike can page us — but the
// worker package stays Sentry-agnostic: it calls an INJECTED reporter (no-op by default), and the
// app wires the real Sentry emitter. handleAuditFailure is the extracted, unit-testable core.
describe('handleAuditFailure (marks failed + emits the injected audit-failed signal)', () => {
  function fakeSb() {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ update });
    return { sb: { from } as unknown as Parameters<typeof handleAuditFailure>[0], from, update, eq };
  }
  const failureEvent = (auditId?: string) => ({ data: { event: { data: auditId ? { auditId } : {} } } });

  // The reporter is a module-level singleton; reset it BEFORE each test (not just after) so a test's
  // outcome can never depend on the order it runs in relative to its siblings.
  beforeEach(() => setAuditFailureReporter(() => {}));
  afterEach(() => setAuditFailureReporter(() => {}));

  it('marks the audit failed with the error reason + a completed_at timestamp', async () => {
    const { sb, from, update, eq } = fakeSb();
    await handleAuditFailure(sb, failureEvent('aud-9'), new Error('boom'));
    expect(from).toHaveBeenCalledWith('audits');
    const patch = update.mock.calls[0]![0] as Record<string, unknown>;
    expect(patch.status).toBe('failed');
    expect(patch.failure_reason).toBe('boom');
    expect(typeof patch.completed_at).toBe('string');
    expect(eq).toHaveBeenCalledWith('id', 'aud-9');
  });

  it('reports the failure to the injected reporter with the auditId + reason', async () => {
    const { sb } = fakeSb();
    const reporter = vi.fn();
    setAuditFailureReporter(reporter);
    await handleAuditFailure(sb, failureEvent('aud-9'), new Error('boom'));
    expect(reporter).toHaveBeenCalledWith({ auditId: 'aud-9', reason: 'boom' });
  });

  it('no-ops (no DB write, no report) when the failure event carries no auditId', async () => {
    const { sb, from } = fakeSb();
    const reporter = vi.fn();
    setAuditFailureReporter(reporter);
    await handleAuditFailure(sb, failureEvent(undefined), new Error('boom'));
    expect(from).not.toHaveBeenCalled();
    expect(reporter).not.toHaveBeenCalled();
  });

  it('uses "unknown" as the reason for a non-Error throw', async () => {
    const { sb, update } = fakeSb();
    await handleAuditFailure(sb, failureEvent('a'), 'weird-string-throw');
    expect((update.mock.calls[0]![0] as Record<string, unknown>).failure_reason).toBe('unknown');
  });

  it('is best-effort about telemetry: a throwing reporter does not break failure handling', async () => {
    const { sb } = fakeSb();
    setAuditFailureReporter(() => {
      throw new Error('sentry down');
    });
    await expect(handleAuditFailure(sb, failureEvent('a'), new Error('x'))).resolves.toBeUndefined();
  });

  it('defaults to a no-op reporter (no throw when nothing is wired)', async () => {
    const { sb } = fakeSb();
    // No setAuditFailureReporter call → the default must be a safe no-op.
    await expect(handleAuditFailure(sb, failureEvent('a'), new Error('x'))).resolves.toBeUndefined();
  });

  it('still emits the audit-failed signal even if the DB update itself rejects (alert must not be lost)', async () => {
    // A permanently-failed audit must page us regardless of whether the bookkeeping write landed.
    const eq = vi.fn().mockRejectedValue(new Error('db down'));
    const update = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ update });
    const sb = { from } as unknown as Parameters<typeof handleAuditFailure>[0];
    const reporter = vi.fn();
    setAuditFailureReporter(reporter);
    // The DB error still propagates (so Inngest surfaces it) — but the signal fired first.
    await expect(handleAuditFailure(sb, failureEvent('aud-9'), new Error('boom'))).rejects.toThrow('db down');
    expect(reporter).toHaveBeenCalledWith({ auditId: 'aud-9', reason: 'boom' });
  });
});
