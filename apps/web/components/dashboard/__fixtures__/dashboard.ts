import type { DashboardSite } from '../dashboard-logic';

// Fixtures for the Pro dashboard (the "what-changed" retention view). Built against the PROPOSED
// DashboardSite shape; swapped for SPEC 02's real per-site aggregation at integration.

// Improved since last visit — the reward moment (C → B), open fix loop.
const improvedSite: DashboardSite = {
  url: 'https://yourshop.com',
  latestAuditId: 'audit-shop-3',
  grade: 'B',
  score: 81,
  confidence: 'high',
  lastRunAt: '2026-06-26T09:00:00.000Z',
  delta: { gradeFrom: 'C', gradeTo: 'B', scoreDelta: 12 },
  history: [
    { auditId: 'audit-shop-1', grade: 'D', score: 58, ranAt: '2026-06-01T09:00:00.000Z' },
    { auditId: 'audit-shop-2', grade: 'C', score: 69, ranAt: '2026-06-12T09:00:00.000Z' },
    { auditId: 'audit-shop-3', grade: 'B', score: 81, ranAt: '2026-06-26T09:00:00.000Z' },
  ],
  fixChecklist: { done: 4, total: 7 },
};

// First audit of a site — no delta yet.
const firstRunSite: DashboardSite = {
  url: 'https://blog.example',
  latestAuditId: 'audit-blog-1',
  grade: 'C',
  score: 64,
  confidence: 'medium',
  lastRunAt: '2026-06-25T12:00:00.000Z',
  delta: null,
  history: [{ auditId: 'audit-blog-1', grade: 'C', score: 64, ranAt: '2026-06-25T12:00:00.000Z' }],
  fixChecklist: { done: 0, total: 5 },
};

// Regressed since last visit (B → C) — a nudge to act.
const regressedSite: DashboardSite = {
  url: 'https://docs.example',
  latestAuditId: 'audit-docs-3',
  grade: 'C',
  score: 71,
  confidence: 'high',
  lastRunAt: '2026-06-24T08:00:00.000Z',
  delta: { gradeFrom: 'B', gradeTo: 'C', scoreDelta: -8 },
  history: [
    { auditId: 'audit-docs-1', grade: 'A', score: 92, ranAt: '2026-05-20T08:00:00.000Z' },
    { auditId: 'audit-docs-2', grade: 'B', score: 84, ranAt: '2026-06-05T08:00:00.000Z' },
    { auditId: 'audit-docs-3', grade: 'C', score: 71, ranAt: '2026-06-24T08:00:00.000Z' },
  ],
  fixChecklist: { done: 1, total: 6 },
};

export const dashboardSites: DashboardSite[] = [improvedSite, firstRunSite, regressedSite];
export const dashboardEmpty: DashboardSite[] = [];
export { improvedSite, firstRunSite, regressedSite };
