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
