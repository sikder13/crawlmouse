import { describe, it, expect } from 'vitest';
import { projectAuditForClient, type AuditRow } from './audit-stream-projection';

const row = (o: Partial<AuditRow> = {}): AuditRow => ({
  id: 'a1',
  status: 'completed',
  grade: 'A',
  score: '92.50',
  page_count: 10,
  link_count: 40,
  cms_detected: 'custom',
  user_id: 'user-123',
  settings: { pageCap: 500 },
  failure_reason: null,
  confidence: null,
  coverage_pct: null,
  block_rate: null,
  partial: null,
  ...o,
});

describe('projectAuditForClient', () => {
  it('never puts user_id on the wire', () => {
    const out = projectAuditForClient(row({ user_id: 'secret-user' }));
    expect('user_id' in out).toBe(false);
    expect(JSON.stringify(out)).not.toContain('secret-user');
  });

  it('never puts the raw failure_reason on the wire — only the coarse category', () => {
    const out = projectAuditForClient(
      row({
        status: 'failed',
        grade: null,
        score: null,
        failure_reason: 'Request timed out after 15000ms: https://internal.example/secret-path',
      }),
    );
    expect('failure_reason' in out).toBe(false);
    expect(JSON.stringify(out)).not.toContain('secret-path');
    expect(out.failureCategory).toBe('timeout');
  });

  it('coerces the PostgREST numeric-string score to a number', () => {
    expect(projectAuditForClient(row({ score: '87.25' })).score).toBe(87.25);
    expect(projectAuditForClient(row({ score: null })).score).toBe(null);
  });

  it('only a failed audit gets a failureCategory; everything else is null', () => {
    expect(projectAuditForClient(row({ status: 'completed' })).failureCategory).toBe(null);
    expect(projectAuditForClient(row({ status: 'crawling' })).failureCategory).toBe(null);
    // A stray reason on a non-failed row is ignored; a real failure is classified.
    expect(
      projectAuditForClient(row({ status: 'completed', failure_reason: 'getaddrinfo ENOTFOUND x' })).failureCategory,
    ).toBe(null);
    expect(
      projectAuditForClient(row({ status: 'failed', grade: null, score: null, failure_reason: 'getaddrinfo ENOTFOUND x' }))
        .failureCategory,
    ).toBe('dns');
  });

  it('passes through the client-safe fields', () => {
    const out = projectAuditForClient(row({ id: 'z9', grade: 'B', cms_detected: 'shopify' }));
    expect(out).toMatchObject({
      id: 'z9',
      status: 'completed',
      grade: 'B',
      cms_detected: 'shopify',
      page_count: 10,
      link_count: 40,
      settings: { pageCap: 500 },
    });
  });
});

// SPEC 01 §6/§10 (v2): per-audit crawl-health rides the SAME client-safe projection chokepoint so
// the client can enrich `audit-completed` with it. The numeric columns (coverage_pct / block_rate)
// arrive from PostgREST as STRINGS and must be coerced to numbers (like score) so PostHog charts a
// real distribution, not string buckets. A v1 row (NULL columns) must project to `crawlHealth: null`
// so the client adds no crawl-health props — zero new emits on the v1 path.
describe('projectAuditForClient — crawl-health (§6/§10, v2)', () => {
  it('carries crawl-health to the client, coercing PostgREST numeric strings to numbers', () => {
    const out = projectAuditForClient(
      row({ confidence: 'high', coverage_pct: '0.9500', block_rate: '0.0200', partial: false }),
    );
    expect(out.crawlHealth).toEqual({ confidence: 'high', coveragePct: 0.95, blockRate: 0.02, partial: false });
  });

  it('projects to null when the crawl-health columns are NULL (a v1 audit) — client emits no crawl-health props', () => {
    const out = projectAuditForClient(row({ confidence: null, coverage_pct: null, block_rate: null, partial: null }));
    expect(out.crawlHealth).toBe(null);
  });

  it('carries a low-confidence / partial crawl through unchanged (the degraded case the UI caveats)', () => {
    const out = projectAuditForClient(
      row({ confidence: 'low', coverage_pct: '0.5', block_rate: '0.3', partial: true }),
    );
    expect(out.crawlHealth).toEqual({ confidence: 'low', coveragePct: 0.5, blockRate: 0.3, partial: true });
  });
});
