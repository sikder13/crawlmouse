import { describe, it, expect } from 'vitest';
import {
  freeFixture,
  proOwnerFixture,
  proNonOwnerFixture,
  estimateFixture,
  errorFixture,
  xssFixture,
  cappedGraphFixture,
  jsOnlyHeavyFixture,
} from './client-audit-v2';

describe('ClientAuditV2 fixtures — shape & gating', () => {
  it('free: full diagnosis + one cure; gated cures ABSENT from the payload', () => {
    expect(freeFixture.freeFix).not.toBeNull();
    expect(freeFixture.projectedGrade?.ledger.length).toBeGreaterThan(0);
    expect(freeFixture.findings.length).toBeGreaterThan(0);
    expect(freeFixture.hasMorePrescriptions).toBe(true);
    expect(freeFixture.prescriptions).toBeNull(); // not withheld in UI — absent in payload
    expect(freeFixture.monitoring).toBeNull();
    expect(freeFixture.entitlement.canSeeAllPrescriptions).toBe(false);
    expect(freeFixture.confidenceBand?.isEstimate).toBe(false);
  });

  it('pro-owner: cures + monitoring present; gates open', () => {
    expect(proOwnerFixture.prescriptions?.length).toBeGreaterThan(0);
    expect(proOwnerFixture.monitoring).not.toBeNull();
    expect(proOwnerFixture.hasMorePrescriptions).toBe(false);
    expect(proOwnerFixture.entitlement.canSeeAllPrescriptions).toBe(true);
    expect(proOwnerFixture.entitlement.canMonitor).toBe(true);
  });

  it('pro-non-owner: a Pro account, but cures absent (owner-scoped) → free view', () => {
    expect(proNonOwnerFixture.entitlement.tier).toBe('pro');
    expect(proNonOwnerFixture.entitlement.canSeeAllPrescriptions).toBe(false);
    expect(proNonOwnerFixture.prescriptions).toBeNull();
    expect(proNonOwnerFixture.monitoring).toBeNull();
    expect(proNonOwnerFixture.hasMorePrescriptions).toBe(true);
  });

  it('estimate: low-coverage partial → isEstimate with a wide band (~14%)', () => {
    const band = estimateFixture.confidenceBand;
    expect(band).not.toBeNull();
    if (!band) return;
    expect(band.isEstimate).toBe(true);
    expect(band.confidence).toBe('low');
    expect(estimateFixture.crawlHealth?.partial).toBe(true);
    const { crawled, estimatedTotal } = band.basis;
    expect(estimatedTotal).not.toBeNull();
    expect(crawled / (estimatedTotal ?? 1)).toBeLessThan(0.2); // ~14% coverage
    expect(band.upper - band.lower).toBeGreaterThanOrEqual(20); // wide ±12 band
  });

  it('error: a failed audit exposes only the coarse failureCategory', () => {
    expect(errorFixture.status).toBe('failed');
    expect(errorFixture.failureCategory).toBe('timeout');
    expect(errorFixture.grade).toBeNull();
    expect(errorFixture.projectedGrade).toBeNull();
    expect(errorFixture.freeFix).toBeNull();
  });

  it('xss: attacker-controlled strings are present (components must escape them at render)', () => {
    expect(xssFixture.freeFix?.diagnosis.targetTitle).toContain('<script>');
    expect(xssFixture.freeFix?.prescription.actionPacket.body).toContain('<script>');
    expect(xssFixture.projectedGrade?.ledger[0]?.rationale).toContain('<script>');
  });
});

describe('ClientAuditV2 v1.2 — graph + viewerSignedIn', () => {
  it('every completed fixture carries a graph; the error fixture has none', () => {
    expect(freeFixture.graph).not.toBeNull();
    expect(errorFixture.graph).toBeNull();
  });

  it('the normal graph has a homepage node, an orphan node, and only neutral (non-nofollow) edges', () => {
    const g = freeFixture.graph;
    expect(g).not.toBeNull();
    if (!g) return;
    expect(g.nodes.some((n) => n.isHomepage && n.depth === 0)).toBe(true);
    expect(g.nodes.some((n) => n.isOrphan)).toBe(true);
    // nofollow is display-only and always false in v1.2 — no UI may depend on it meaning anything.
    expect(g.edges.every((e) => e.nofollow === false)).toBe(true);
    expect(g.capped).toBe(false);
  });

  it('the capped fixture reports the true pre-cap total and the free-tier cap reason', () => {
    const g = cappedGraphFixture.graph;
    expect(g).not.toBeNull();
    if (!g) return;
    expect(g.capped).toBe(true);
    expect(g.capReason).toBe('free_tier');
    expect(g.totalNodes).toBeGreaterThan(g.nodes.length);
  });

  it('the jsOnly-heavy fixture has multiple jsOnly nodes (the AI-crawler reachability story)', () => {
    const g = jsOnlyHeavyFixture.graph;
    expect(g).not.toBeNull();
    if (!g) return;
    expect(g.nodes.filter((n) => n.jsOnly).length).toBeGreaterThanOrEqual(2);
  });

  it('viewerSignedIn: signed-out for the free viewer, signed-in for the Pro owner', () => {
    expect(freeFixture.viewerSignedIn).toBe(false);
    expect(proOwnerFixture.viewerSignedIn).toBe(true);
  });
});
