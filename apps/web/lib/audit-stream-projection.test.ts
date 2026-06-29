import { describe, it, expect } from 'vitest';
import { projectAuditForClient, type AuditRow, type ConversionProjectionInput } from './audit-stream-projection';
import { entitlementFor } from './entitlement';
import type { ConfidenceBand, ProjectedGrade, FreeFix, FixPrescription, MonitoringDelta, Finding } from '@crawlmouse/types';

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

// SPEC 02 §6/§7 — the wall inversion. The cure (`prescriptions` + `monitoring`) is OWNER-SCOPED:
// served only to the authenticated owner who is Pro. The free taste (`freeFix`, the `projectedGrade`
// ledger, `confidenceBand`, the full `findings` diagnosis) is ALWAYS present. Gated fields are `null`
// AND must never appear anywhere in the serialized payload.
const band: ConfidenceBand = {
  pointEstimate: 92.5, grade: 'A', lower: 90.5, upper: 94.5, confidence: 'high',
  basis: { crawled: 10, estimatedTotal: 10, method: 'sitemap' }, isEstimate: false,
};
const freePrescription: FixPrescription = {
  fixId: 'orphan:https://x.com/o',
  suggestedLinks: [{ fromUrl: 'https://x.com/h', fromTitle: 'Home', anchorText: 'the orphan page', relevanceScore: 0.8 }],
  actionPacket: { fixId: 'orphan:https://x.com/o', format: 'markdown', body: 'FREE TASTE BODY', copyLabel: 'Copy for ChatGPT / Claude' },
};
const gatedPrescription: FixPrescription = {
  fixId: 'deep_page:https://x.com/d',
  suggestedLinks: [{ fromUrl: 'https://x.com/h', fromTitle: 'Home', anchorText: 'a deep page', relevanceScore: 0.5 }],
  actionPacket: { fixId: 'deep_page:https://x.com/d', format: 'markdown', body: 'GATED CURE BODY', copyLabel: 'Copy for ChatGPT / Claude' },
};
const freeFix: FreeFix = {
  diagnosis: { id: 'orphan:https://x.com/o', category: 'orphan', targetUrl: 'https://x.com/o', targetTitle: 'Orphan', marginalDelta: 5, effort: 'low', rationale: 'no inbound links' },
  prescription: freePrescription,
  rank: 1,
};
const projectedGrade: ProjectedGrade = {
  current: { score: 92.5, grade: 'A' }, projected: { score: 97, grade: 'A' },
  ledger: [freeFix.diagnosis], disclaimer: 'Estimated, not guaranteed.',
};
const monitoring: MonitoringDelta = {
  previousAuditId: 'prev', currentAuditId: 'a1', scoreDelta: 3, gradeFrom: 'B', gradeTo: 'A',
  resolvedFixIds: ['x'], newFixIds: [], ranAt: '2026-06-29T00:00:00Z',
};
const findings: Finding[] = [{ category: 'orphan', severity: 'critical', pageUrl: 'https://x.com/o', payload: { secret: 'PAYLOAD_SECRET' } }];
const conv = (over: Partial<ConversionProjectionInput> = {}): ConversionProjectionInput => ({
  entitlement: entitlementFor('pro', null),
  isOwner: true,
  confidenceBand: band,
  projectedGrade,
  freeFix,
  prescriptions: [freePrescription, gatedPrescription],
  monitoring,
  findings,
  orphanCount: 1,
  avgDepth: 2.5,
  ...over,
});

describe('projectAuditForClient — conversion core (§6/§7 owner-scoped wall)', () => {
  it('single-arg projection is the legacy ClientAudit — no conversion keys leak onto v1 payloads', () => {
    const out = projectAuditForClient(row());
    expect('entitlement' in out).toBe(false);
    expect('projectedGrade' in out).toBe(false);
    expect('prescriptions' in out).toBe(false);
    expect('freeFix' in out).toBe(false);
  });

  it('owner+Pro receives the full cure (prescriptions + monitoring populated)', () => {
    const out = projectAuditForClient(row(), conv());
    expect(out.prescriptions).toHaveLength(2);
    expect(out.monitoring).not.toBeNull();
    expect(out.hasMorePrescriptions).toBe(true); // 2 cures > 1 free
    expect(JSON.stringify(out)).toContain('GATED CURE BODY'); // entitled → cure delivered
  });

  it('SECURITY: a FREE owner gets the free taste but NEVER the gated cure', () => {
    const out = projectAuditForClient(row(), conv({ entitlement: entitlementFor('free', null) }));
    expect(out.prescriptions).toBeNull();
    expect(out.monitoring).toBeNull();
    expect(JSON.stringify(out)).not.toContain('GATED CURE BODY'); // gated cure never serialized
    // the FREE taste IS delivered
    expect(out.freeFix).not.toBeNull();
    expect(out.projectedGrade).not.toBeNull();
    expect(out.confidenceBand).not.toBeNull();
    expect(JSON.stringify(out)).toContain('FREE TASTE BODY');
    expect(out.hasMorePrescriptions).toBe(true); // still signal the wall
  });

  it('SECURITY: a non-owner (even Pro) never receives the cure — owner-scoped, not just tier-scoped', () => {
    const out = projectAuditForClient(row(), conv({ isOwner: false, entitlement: entitlementFor('pro', null) }));
    expect(out.prescriptions).toBeNull();
    expect(out.monitoring).toBeNull();
    expect(JSON.stringify(out)).not.toContain('GATED CURE BODY');
    expect(out.freeFix).not.toBeNull(); // a non-owner still gets the free view
  });

  it('omits Finding.payload on the wire (lean projection)', () => {
    const out = projectAuditForClient(row(), conv());
    expect(out.findings).toHaveLength(1);
    expect('payload' in out.findings[0]!).toBe(false);
    expect(out.findings[0]!.pageUrl).toBe('https://x.com/o');
    expect(JSON.stringify(out)).not.toContain('PAYLOAD_SECRET');
  });

  it('hasMorePrescriptions is false when only the single free fix exists', () => {
    const out = projectAuditForClient(row(), conv({ prescriptions: [freePrescription] }));
    expect(out.hasMorePrescriptions).toBe(false);
  });

  it('still strips user_id on the v2 (conversion) path', () => {
    const out = projectAuditForClient(row({ user_id: 'secret-user' }), conv());
    expect('user_id' in out).toBe(false);
    expect(JSON.stringify(out)).not.toContain('secret-user');
  });
});
