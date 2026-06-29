import type { ClientAuditV2 } from '@/lib/audit-stream-projection';
import type {
  ConfidenceBand,
  Entitlement,
  Finding,
  FixDiagnosis,
  FixPrescription,
  FreeFix,
  MonitoringDelta,
  ProjectedGrade,
} from '@crawlmouse/types';
// v1.2 graph types (local shim; re-points to '@crawlmouse/types' at Phase G — see lib/contract-v1_2.ts).
import type { GraphData, GraphEdge, GraphNode } from '@/lib/contract-v1_2';

// Fixtures matching the FROZEN ClientAuditV2 contract (SPEC 03 §1 + amendment v1.1). They are typed
// as the real ClientAuditV2, so TypeScript validates them against the contract. The result page +
// dashboard render against these until SPEC 02's real data lands at integration (then deleted/kept
// for tests). Strings in the xss fixture are attacker-controlled (crawled) — must render escaped.

// ── Entitlements ─────────────────────────────────────────────────────────────
const FREE_ENT: Entitlement = {
  tier: 'free',
  proUntil: null,
  canSeeAllPrescriptions: false,
  canUseActionPackets: false,
  canMonitor: false,
  canSeeFullSiteGrade: false,
  canWhiteLabel: false,
};

const PRO_OWNER_ENT: Entitlement = {
  tier: 'pro',
  proUntil: '2026-12-31T00:00:00.000Z',
  canSeeAllPrescriptions: true,
  canUseActionPackets: true,
  canMonitor: true,
  canSeeFullSiteGrade: true,
  canWhiteLabel: false,
};

// A Pro ACCOUNT viewing a NON-owned audit → effective (owner-scoped) gates are free-equivalent.
const PRO_NON_OWNER_ENT: Entitlement = {
  tier: 'pro',
  proUntil: '2026-12-31T00:00:00.000Z',
  canSeeAllPrescriptions: false,
  canUseActionPackets: false,
  canMonitor: false,
  canSeeFullSiteGrade: false,
  canWhiteLabel: false,
};

// ── Shared diagnosis data (the gap ledger; sorted by marginalDelta desc) ──────
const D_ORPHAN: FixDiagnosis = {
  id: 'fix-orphan-pricing',
  category: 'orphan',
  targetUrl: 'https://mystore.example/pricing',
  targetTitle: 'Pricing',
  marginalDelta: 8.4,
  effort: 'low',
  rationale: 'Nothing on your site links to this page, so search engines and AI crawlers rarely find it.',
};
const D_DEEP_GUIDE: FixDiagnosis = {
  id: 'fix-deep-guide',
  category: 'deep_page',
  targetUrl: 'https://mystore.example/guides/internal-linking',
  targetTitle: 'The Internal Linking Guide',
  marginalDelta: 6.1,
  effort: 'medium',
  rationale: 'This page sits 6 clicks from the homepage; important pages should be within 3.',
};
const D_UNDERLINKED_FAQ: FixDiagnosis = {
  id: 'fix-underlinked-faq',
  category: 'under_linked_important',
  targetUrl: 'https://mystore.example/faq',
  targetTitle: 'FAQ',
  marginalDelta: 4.7,
  effort: 'low',
  rationale: 'A high-value page with only one inbound internal link.',
};
const D_GENERIC_ANCHOR: FixDiagnosis = {
  id: 'fix-generic-anchor-blog',
  category: 'generic_anchor_overuse',
  targetUrl: 'https://mystore.example/blog',
  targetTitle: 'Blog',
  marginalDelta: 3.2,
  effort: 'low',
  rationale: 'Many links here read "click here" or "read more" instead of describing the destination.',
};
const D_NEAR_ORPHAN: FixDiagnosis = {
  id: 'fix-near-orphan-about',
  category: 'near_orphan',
  targetUrl: 'https://mystore.example/about',
  targetTitle: 'About Us',
  marginalDelta: 2.3,
  effort: 'low',
  rationale: 'Only one internal link points here, so it is easy to miss.',
};
const D_DEEP_RETURNS: FixDiagnosis = {
  id: 'fix-deep-returns',
  category: 'deep_page',
  targetUrl: 'https://mystore.example/returns',
  targetTitle: 'Returns Policy',
  marginalDelta: 1.6,
  effort: 'medium',
  rationale: 'Buried deep in the site; shoppers and crawlers struggle to reach it.',
};

const LEDGER: FixDiagnosis[] = [
  D_ORPHAN,
  D_DEEP_GUIDE,
  D_UNDERLINKED_FAQ,
  D_GENERIC_ANCHOR,
  D_NEAR_ORPHAN,
  D_DEEP_RETURNS,
];

// Full diagnosis (amendment v1.1): every finding, incl. site-wide informational ones (no pageUrl).
const FINDINGS: Finding[] = [
  { category: 'orphan', severity: 'critical', pageUrl: 'https://mystore.example/pricing' },
  { category: 'deep_page', severity: 'medium', pageUrl: 'https://mystore.example/guides/internal-linking' },
  { category: 'under_linked_important', severity: 'medium', pageUrl: 'https://mystore.example/faq' },
  { category: 'generic_anchor_overuse', severity: 'minor', pageUrl: 'https://mystore.example/blog' },
  { category: 'near_orphan', severity: 'minor', pageUrl: 'https://mystore.example/about' },
  { category: 'js_rendered', severity: 'minor' },
  { category: 'incomplete_crawl', severity: 'minor' },
];

const PROJECTED: ProjectedGrade = {
  current: { score: 64, grade: 'C' },
  projected: { score: 86, grade: 'B+' },
  ledger: LEDGER,
  disclaimer: 'Estimated, not guaranteed. Per-fix impacts are relative and do not sum.',
};

const HIGH_BAND: ConfidenceBand = {
  pointEstimate: 64,
  grade: 'C',
  lower: 61,
  upper: 67,
  confidence: 'high',
  basis: { crawled: 48, estimatedTotal: 50, method: 'frontier' },
  isEstimate: false,
};

// The one free, complete cure (highest impact).
const FREE_FIX: FreeFix = {
  rank: 1,
  diagnosis: D_ORPHAN,
  prescription: {
    fixId: 'fix-orphan-pricing',
    suggestedLinks: [
      { fromUrl: 'https://mystore.example/', fromTitle: 'Home', anchorText: 'see our pricing', relevanceScore: 0.82 },
      { fromUrl: 'https://mystore.example/features', fromTitle: 'Features', anchorText: 'compare plans and pricing', relevanceScore: 0.74 },
      { fromUrl: 'https://mystore.example/faq', fromTitle: 'FAQ', anchorText: 'how much it costs', relevanceScore: 0.68 },
    ],
    actionPacket: {
      fixId: 'fix-orphan-pricing',
      format: 'markdown',
      body: [
        '## Fix: link to your orphaned Pricing page',
        '',
        'Add internal links to `https://mystore.example/pricing` from these pages:',
        '- **Home** — anchor: "see our pricing"',
        '- **Features** — anchor: "compare plans and pricing"',
        '- **FAQ** — anchor: "how much it costs"',
        '',
        'Why: the Pricing page currently has 0 inbound internal links, so crawlers rarely reach it.',
      ].join('\n'),
      copyLabel: 'Copy for ChatGPT / Claude',
    },
  },
};

// Gated cures for the non-free fixes (owner + Pro only).
const PRESCRIPTIONS: FixPrescription[] = [
  {
    fixId: 'fix-deep-guide',
    suggestedLinks: [
      { fromUrl: 'https://mystore.example/', fromTitle: 'Home', anchorText: 'our internal linking guide', relevanceScore: 0.71 },
    ],
    actionPacket: {
      fixId: 'fix-deep-guide',
      format: 'markdown',
      body: '## Fix: surface the Internal Linking Guide\n\nLink to it from the homepage and the Blog index to cut its click-depth.',
      copyLabel: 'Copy for ChatGPT / Claude',
    },
  },
  {
    fixId: 'fix-underlinked-faq',
    suggestedLinks: [
      { fromUrl: 'https://mystore.example/pricing', fromTitle: 'Pricing', anchorText: 'common questions', relevanceScore: 0.7 },
    ],
    actionPacket: {
      fixId: 'fix-underlinked-faq',
      format: 'markdown',
      body: '## Fix: strengthen links to the FAQ\n\nAdd inbound links from Pricing and Checkout.',
      copyLabel: 'Copy for ChatGPT / Claude',
    },
  },
];

const MONITORING: MonitoringDelta = {
  previousAuditId: 'audit-prev-0001',
  currentAuditId: 'audit-pro-owner',
  scoreDelta: 6,
  gradeFrom: 'D',
  gradeTo: 'C',
  resolvedFixIds: ['fix-near-orphan-about'],
  newFixIds: ['fix-deep-returns'],
  ranAt: '2026-06-20T10:00:00.000Z',
};

// ── v1.2 link-graph fixtures (D3). Deterministic; exercise depth color, pagerank size, orphan flash,
//    the jsOnly reachability story, and the cap banner. nofollow is display-only → always false. ──
function gNode(id: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    url: id,
    title: null,
    depth: 1,
    isHomepage: false,
    isOrphan: false,
    pagerank: 0.05,
    jsOnly: false,
    inboundCount: 1,
    outboundCount: 1,
    ...over,
  };
}
const gEdge = (from: string, to: string): GraphEdge => ({ from, to, nofollow: false });

const M = 'https://mystore.example';
// A small, readable graph (homepage hub + the ledger pages). `pricing` is the orphan (0 inbound).
const NORMAL_NODES: GraphNode[] = [
  gNode(`${M}/`, { title: 'Home', isHomepage: true, depth: 0, pagerank: 0.3, inboundCount: 2, outboundCount: 5 }),
  gNode(`${M}/features`, { title: 'Features', depth: 1, pagerank: 0.14, inboundCount: 2, outboundCount: 3 }),
  gNode(`${M}/blog`, { title: 'Blog', depth: 1, pagerank: 0.12, inboundCount: 3, outboundCount: 4 }),
  gNode(`${M}/faq`, { title: 'FAQ', depth: 2, pagerank: 0.1, inboundCount: 1, outboundCount: 2 }),
  gNode(`${M}/about`, { title: 'About Us', depth: 3, pagerank: 0.05, inboundCount: 1, outboundCount: 1 }),
  gNode(`${M}/returns`, { title: 'Returns Policy', depth: 5, pagerank: 0.03, inboundCount: 1, outboundCount: 0 }),
  gNode(`${M}/guides/internal-linking`, { title: 'The Internal Linking Guide', depth: 6, pagerank: 0.08, inboundCount: 1, outboundCount: 1 }),
  gNode(`${M}/pricing`, { title: 'Pricing', isOrphan: true, depth: null, pagerank: 0.03, inboundCount: 0, outboundCount: 1 }),
];
const NORMAL_EDGES: GraphEdge[] = [
  gEdge(`${M}/`, `${M}/features`),
  gEdge(`${M}/`, `${M}/blog`),
  gEdge(`${M}/`, `${M}/faq`),
  gEdge(`${M}/`, `${M}/about`),
  gEdge(`${M}/`, `${M}/guides/internal-linking`),
  gEdge(`${M}/features`, `${M}/returns`),
  gEdge(`${M}/blog`, `${M}/faq`),
  gEdge(`${M}/blog`, `${M}/about`),
  gEdge(`${M}/blog`, `${M}/returns`),
  gEdge(`${M}/faq`, `${M}/returns`),
];
const NORMAL_GRAPH: GraphData = {
  nodes: NORMAL_NODES,
  edges: NORMAL_EDGES,
  totalNodes: NORMAL_NODES.length,
  totalEdges: NORMAL_EDGES.length,
  capped: false,
  capReason: 'none',
};

// A JS/SPA site: the homepage is a near-empty shell and key pages are reachable only via JS nav, so
// they have NO static edges → jsOnly + orphan. This carries the AI-crawler reachability story.
const A = 'https://spa.example';
const JSONLY_NODES: GraphNode[] = [
  gNode(`${A}/`, { title: 'Home (app shell)', isHomepage: true, depth: 0, pagerank: 0.4, inboundCount: 1, outboundCount: 1 }),
  gNode(`${A}/blog`, { title: 'Blog', depth: 1, pagerank: 0.2, inboundCount: 1, outboundCount: 1 }),
  gNode(`${A}/about`, { title: 'About', depth: 1, pagerank: 0.12, inboundCount: 1, outboundCount: 1 }),
  gNode(`${A}/app/dashboard`, { title: 'Dashboard', jsOnly: true, isOrphan: true, depth: null, pagerank: 0.12, inboundCount: 0, outboundCount: 0 }),
  gNode(`${A}/app/products`, { title: 'Products', jsOnly: true, isOrphan: true, depth: null, pagerank: 0.1, inboundCount: 0, outboundCount: 0 }),
  gNode(`${A}/app/pricing`, { title: 'Pricing', jsOnly: true, isOrphan: true, depth: null, pagerank: 0.1, inboundCount: 0, outboundCount: 0 }),
];
const JSONLY_EDGES: GraphEdge[] = [
  gEdge(`${A}/`, `${A}/blog`),
  gEdge(`${A}/blog`, `${A}/about`),
  gEdge(`${A}/about`, `${A}/blog`),
];
const JSONLY_GRAPH: GraphData = {
  nodes: JSONLY_NODES,
  edges: JSONLY_EDGES,
  totalNodes: JSONLY_NODES.length,
  totalEdges: JSONLY_EDGES.length,
  capped: false,
  capReason: 'none',
};

// A large site capped to the FREE node budget (150), with the true totals reported → the UI says
// "showing 150 of 1,240 pages" + the Pro "see your full graph" upsell.
const B = 'https://big.example';
const CAPPED_NODES: GraphNode[] = Array.from({ length: 150 }, (_, i) =>
  gNode(i === 0 ? `${B}/` : `${B}/p/${i}`, {
    title: i === 0 ? 'Home' : `Page ${i}`,
    isHomepage: i === 0,
    depth: i === 0 ? 0 : 1 + (i % 6),
    pagerank: i === 0 ? 0.5 : Math.max(0.01, 0.4 / (i + 1)),
    isOrphan: i !== 0 && i % 23 === 0,
    jsOnly: i !== 0 && i % 17 === 0,
    inboundCount: i === 0 ? 0 : 1 + (i % 3),
    outboundCount: i % 4,
  }),
);
const CAPPED_EDGES: GraphEdge[] = CAPPED_NODES.slice(1).map((n) => gEdge(`${B}/`, n.id));
const CAPPED_GRAPH: GraphData = {
  nodes: CAPPED_NODES,
  edges: CAPPED_EDGES,
  totalNodes: 1240,
  totalEdges: 4870,
  capped: true,
  capReason: 'free_tier',
};

// ── The fixtures ──────────────────────────────────────────────────────────────

/** FREE viewer (anonymous or signed-in free): full diagnosis + one cure; cures gated. */
export const freeFixture: ClientAuditV2 = {
  id: 'audit-free-0001',
  status: 'completed',
  grade: 'C',
  score: 64,
  page_count: 48,
  link_count: 213,
  cms_detected: 'wordpress',
  settings: { pageCap: 500 },
  failureCategory: null,
  crawlHealth: { confidence: 'high', coveragePct: 0.96, blockRate: 0, partial: false },
  entitlement: FREE_ENT,
  confidenceBand: HIGH_BAND,
  projectedGrade: PROJECTED,
  freeFix: FREE_FIX,
  prescriptions: null,
  monitoring: null,
  hasMorePrescriptions: true,
  findings: FINDINGS,
  orphanCount: 7,
  avgDepth: 3.2,
  viewerSignedIn: false, // signed-out free viewer → the STAY beat shows
  graph: NORMAL_GRAPH,
};

/** PRO OWNER: same audit, all cures + the monitoring delta present. */
export const proOwnerFixture: ClientAuditV2 = {
  ...freeFixture,
  id: 'audit-pro-owner',
  viewerSignedIn: true, // signed-in owner
  entitlement: PRO_OWNER_ENT,
  prescriptions: PRESCRIPTIONS,
  monitoring: MONITORING,
  hasMorePrescriptions: false,
};

/** PRO account viewing a NON-owned audit → renders the FREE view (cures absent from payload). */
export const proNonOwnerFixture: ClientAuditV2 = {
  ...freeFixture,
  id: 'audit-pro-nonowner',
  viewerSignedIn: true, // a Pro account is signed in (but not the owner of this audit)
  entitlement: PRO_NON_OWNER_ENT,
  prescriptions: null,
  monitoring: null,
  hasMorePrescriptions: true,
};

/** ESTIMATE: low-coverage partial crawl (~14%) → grade shown as an estimate, wide band. */
export const estimateFixture: ClientAuditV2 = {
  ...freeFixture,
  id: 'audit-estimate-0001',
  grade: 'B',
  score: 84,
  page_count: 70,
  crawlHealth: { confidence: 'low', coveragePct: 0.14, blockRate: 0.02, partial: true },
  confidenceBand: {
    pointEstimate: 84,
    grade: 'B',
    lower: 72,
    upper: 96,
    confidence: 'low',
    basis: { crawled: 70, estimatedTotal: 500, method: 'sitemap' },
    isEstimate: true,
  },
  projectedGrade: {
    current: { score: 84, grade: 'B' },
    projected: { score: 93, grade: 'A-' },
    ledger: LEDGER,
    disclaimer: PROJECTED.disclaimer,
  },
};

/** ERROR: a failed audit. Only the coarse, classified failureCategory crosses to the client. */
export const errorFixture: ClientAuditV2 = {
  id: 'audit-error-0001',
  status: 'failed',
  grade: null,
  score: null,
  page_count: null,
  link_count: null,
  cms_detected: null,
  settings: { pageCap: 500 },
  failureCategory: 'timeout',
  crawlHealth: null,
  entitlement: FREE_ENT,
  confidenceBand: null,
  projectedGrade: null,
  freeFix: null,
  prescriptions: null,
  monitoring: null,
  hasMorePrescriptions: false,
  findings: [],
  orphanCount: 0,
  avgDepth: null,
  viewerSignedIn: false,
  graph: null, // null while building / on error
};

// ── XSS fixture: attacker-controlled (crawled) strings must render ESCAPED (U12) ──
const XSS_TAG = '<script>alert("xss")</script>';
const XSS_ATTR = '"><img src=x onerror=alert(1)>';

// Crawled (attacker-controlled) node strings — the graph's DOM surfaces (hover detail, a11y fallback)
// must render these escaped; canvas fillText is inert by nature.
const XSS_GRAPH: GraphData = {
  nodes: [
    gNode(`${M}/`, { title: 'Home', isHomepage: true, depth: 0, pagerank: 0.3, inboundCount: 2, outboundCount: 2 }),
    gNode(`https://evil.example/${XSS_ATTR}`, { title: XSS_TAG, isOrphan: true, jsOnly: true, depth: null, pagerank: 0.05, inboundCount: 0, outboundCount: 0 }),
  ],
  edges: [],
  totalNodes: 2,
  totalEdges: 0,
  capped: false,
  capReason: 'none',
};

const XSS_DIAGNOSIS: FixDiagnosis = {
  id: 'fix-xss',
  category: 'orphan',
  targetUrl: `https://evil.example/${XSS_ATTR}`,
  targetTitle: XSS_TAG,
  marginalDelta: 9.1,
  effort: 'low',
  rationale: `Crawled rationale ${XSS_TAG} & "quoted" 'apostrophe' <b>bold</b>`,
};

export const xssFixture: ClientAuditV2 = {
  ...freeFixture,
  id: 'audit-xss-0001',
  cms_detected: XSS_TAG,
  graph: XSS_GRAPH,
  findings: [{ category: 'orphan', severity: 'critical', pageUrl: `https://evil.example/${XSS_ATTR}` }, ...FINDINGS],
  projectedGrade: { ...PROJECTED, ledger: [XSS_DIAGNOSIS, ...LEDGER] },
  freeFix: {
    rank: 1,
    diagnosis: XSS_DIAGNOSIS,
    prescription: {
      fixId: 'fix-xss',
      suggestedLinks: [
        { fromUrl: `https://evil.example/${XSS_ATTR}`, fromTitle: XSS_TAG, anchorText: XSS_TAG, relevanceScore: 0.9 },
      ],
      actionPacket: {
        fixId: 'fix-xss',
        format: 'markdown',
        body: `## ${XSS_TAG}\n\n- [click](javascript:alert(1))\n& <b>bold</b> "quotes"`,
        copyLabel: 'Copy for ChatGPT / Claude',
      },
    },
  },
};

/** CAPPED GRAPH: a large free-tier site whose graph is truncated to the 150-node free budget. */
export const cappedGraphFixture: ClientAuditV2 = {
  ...freeFixture,
  id: 'audit-capped-0001',
  page_count: 1240,
  graph: CAPPED_GRAPH,
};

/** JS/SPA site: many pages reachable only via JavaScript → jsOnly nodes carry the AI-crawler story. */
export const jsOnlyHeavyFixture: ClientAuditV2 = {
  ...freeFixture,
  id: 'audit-jsonly-0001',
  cms_detected: 'custom',
  graph: JSONLY_GRAPH,
};

export const allFixtures = {
  free: freeFixture,
  proOwner: proOwnerFixture,
  proNonOwner: proNonOwnerFixture,
  estimate: estimateFixture,
  error: errorFixture,
  xss: xssFixture,
  capped: cappedGraphFixture,
  jsOnly: jsOnlyHeavyFixture,
} as const;
