import type { MonitoringDelta } from '@crawlmouse/types';
import type { DashboardSite, DashboardFixChecklistItem } from '../dashboard-logic';

// Fixtures for the Pro dashboard (the "what-changed" retention view), typed against the v1.2
// DashboardSite contract. Swapped for SPEC 02's real per-site aggregation at integration (Phase G).
// Gating: `fixChecklist` is the Pro-owner-only cure tracker → null for a free signed-in owner (→ the
// upgrade path). `delta`/`history`/grade are FREE (the owner's retention hook).

function mkDelta(over: Partial<MonitoringDelta>): MonitoringDelta {
  return {
    previousAuditId: 'audit-prev',
    currentAuditId: 'audit-cur',
    scoreDelta: 0,
    gradeFrom: 'C',
    gradeTo: 'C',
    resolvedFixIds: [],
    newFixIds: [],
    ranAt: '2026-06-26T09:00:00.000Z',
    ...over,
  };
}

const CHECKLIST: DashboardFixChecklistItem[] = [
  { fixId: 'fix-orphan-pricing', label: 'Link to the orphaned Pricing page', category: 'orphan', resolved: true, marginalDelta: 8.4 },
  { fixId: 'fix-deep-guide', label: 'Surface the Internal Linking Guide', category: 'deep_page', resolved: true, marginalDelta: 6.1 },
  { fixId: 'fix-underlinked-faq', label: 'Strengthen links to the FAQ', category: 'under_linked_important', resolved: true, marginalDelta: 4.7 },
  { fixId: 'fix-generic-anchor-blog', label: 'Replace vague link text on the Blog', category: 'generic_anchor_overuse', resolved: true, marginalDelta: 3.2 },
  { fixId: 'fix-near-orphan-about', label: 'Add links to the About page', category: 'near_orphan', resolved: false, marginalDelta: 2.3 },
  { fixId: 'fix-deep-returns', label: 'Surface the Returns Policy', category: 'deep_page', resolved: false, marginalDelta: 1.6 },
  { fixId: 'fix-anchor-home', label: 'Vary the homepage hero anchor', category: 'over_optimized_anchor', resolved: false, marginalDelta: 1.1 },
];

// PRO OWNER, improved since last visit (C→B) — the reward moment; fix checklist present (4 of 7).
export const proOwnerSite: DashboardSite = {
  siteUrl: 'https://yourshop.com',
  latestAuditId: 'audit-shop-4',
  currentGrade: 'B',
  currentScore: 81,
  confidence: 'high',
  delta: mkDelta({
    scoreDelta: 12,
    gradeFrom: 'C',
    gradeTo: 'B',
    previousAuditId: 'audit-shop-3',
    currentAuditId: 'audit-shop-4',
    resolvedFixIds: ['fix-orphan-pricing', 'fix-deep-guide'],
  }),
  history: [
    { auditId: 'audit-shop-1', grade: 'D', score: 56, ranAt: '2026-06-01T09:00:00.000Z' },
    { auditId: 'audit-shop-2', grade: 'C-', score: 62, ranAt: '2026-06-09T09:00:00.000Z' },
    { auditId: 'audit-shop-3', grade: 'C', score: 69, ranAt: '2026-06-17T09:00:00.000Z' },
    { auditId: 'audit-shop-4', grade: 'B', score: 81, ranAt: '2026-06-26T09:00:00.000Z' },
  ],
  fixChecklist: CHECKLIST,
  fixChecklistDoneCount: 4,
};

// FREE signed-in owner — sees grade + delta + history (free), but the cure checklist is Pro-gated
// (null → the upgrade path). Same gating applies to a non-owner viewer.
export const freeOwnerSite: DashboardSite = {
  siteUrl: 'https://blog.example',
  latestAuditId: 'audit-blog-2',
  currentGrade: 'B',
  currentScore: 78,
  confidence: 'medium',
  delta: mkDelta({ scoreDelta: 9, gradeFrom: 'C', gradeTo: 'B', previousAuditId: 'audit-blog-1', currentAuditId: 'audit-blog-2' }),
  history: [
    { auditId: 'audit-blog-1', grade: 'C', score: 69, ranAt: '2026-06-10T12:00:00.000Z' },
    { auditId: 'audit-blog-2', grade: 'B', score: 78, ranAt: '2026-06-25T12:00:00.000Z' },
  ],
  fixChecklist: null, // Pro-gated
  fixChecklistDoneCount: null,
};

// PRO OWNER, regressed since last visit (B→C) — loss aversion + open loop; checklist present (1 of 6).
export const proRegressedSite: DashboardSite = {
  siteUrl: 'https://docs.example',
  latestAuditId: 'audit-docs-4',
  currentGrade: 'C',
  currentScore: 71,
  confidence: 'high',
  delta: mkDelta({
    scoreDelta: -13,
    gradeFrom: 'B',
    gradeTo: 'C',
    previousAuditId: 'audit-docs-3',
    currentAuditId: 'audit-docs-4',
    newFixIds: ['fix-deep-returns'],
  }),
  history: [
    { auditId: 'audit-docs-1', grade: 'A', score: 92, ranAt: '2026-05-20T08:00:00.000Z' },
    { auditId: 'audit-docs-2', grade: 'B+', score: 88, ranAt: '2026-06-02T08:00:00.000Z' },
    { auditId: 'audit-docs-3', grade: 'B', score: 84, ranAt: '2026-06-13T08:00:00.000Z' },
    { auditId: 'audit-docs-4', grade: 'C', score: 71, ranAt: '2026-06-24T08:00:00.000Z' },
  ],
  fixChecklist: CHECKLIST.slice(0, 6).map((c, i) => ({ ...c, resolved: i < 1 })),
  fixChecklistDoneCount: 1,
};

// FIRST audit of a site — no delta yet; free (checklist gated).
export const firstRunSite: DashboardSite = {
  siteUrl: 'https://newsite.example',
  latestAuditId: 'audit-new-1',
  currentGrade: 'C',
  currentScore: 64,
  confidence: 'medium',
  delta: null,
  history: [{ auditId: 'audit-new-1', grade: 'C', score: 64, ranAt: '2026-06-25T12:00:00.000Z' }],
  fixChecklist: null,
  fixChecklistDoneCount: null,
};

export const dashboardSites: DashboardSite[] = [proOwnerSite, freeOwnerSite, proRegressedSite];
export const dashboardEmpty: DashboardSite[] = [];
export { CHECKLIST };
