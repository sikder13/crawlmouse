import { BRAND } from '../../lib/brand';
import type { GraphData, GraphNode } from '../../lib/contract-v1_2';

// Pure logic + copy for the live link graph (D3). All decisions live here so they're unit-tested in
// the node-env suite; the react-force-graph canvas (LinkGraph.tsx) is a thin render layer over these.

// Depth ramp (Sitebulb pattern): homepage darkest (ink), fading to a light tan with depth. Kept
// distinct from the bright peach orphan flash and the jsOnly treatment so the three read apart.
const DEPTH_RAMP = ['#1a1a18', '#44403a', '#6e6456', '#9a7f5e', '#c89a6e', '#e8c49a'] as const;

export function depthColor(depth: number | null): string {
  if (depth == null) return BRAND.inkMuted; // unreachable / unknown depth
  return DEPTH_RAMP[Math.min(Math.max(0, depth), DEPTH_RAMP.length - 1)]!;
}

/** Node radius from normalized pagerank (0..1) → px. sqrt so low-rank nodes stay visible; clamped. */
export function nodeRadius(pagerank: number, min = 3, max = 14): number {
  const p = Math.max(0, Math.min(1, pagerank));
  return min + (max - min) * Math.sqrt(p);
}

export interface NodeStyle {
  fill: string;
  stroke: string | null;
  dashed: boolean;
}
/**
 * Visual encoding — brand-native, three distinct reads:
 *  - jsOnly  → hollow, dashed peach ring: "detached from the static graph — AI crawlers can't reach it"
 *  - orphan  → solid brand peach: the flash-on-find node (no inbound internal links)
 *  - else    → the depth ramp (homepage = ink, with an ink ring to mark the root)
 * jsOnly wins over orphan when both (it's the more specific AI-readiness signal).
 */
export function nodeStyle(node: Pick<GraphNode, 'depth' | 'isHomepage' | 'isOrphan' | 'jsOnly'>): NodeStyle {
  if (node.jsOnly) return { fill: BRAND.peachLight, stroke: BRAND.peach, dashed: true };
  if (node.isOrphan) return { fill: BRAND.peach, stroke: null, dashed: false };
  return { fill: depthColor(node.depth), stroke: node.isHomepage ? BRAND.ink : null, dashed: false };
}

export interface GraphSummary {
  shown: number;
  total: number;
  capped: boolean;
  orphanCount: number;
  jsOnlyCount: number;
}
export function graphSummary(g: GraphData): GraphSummary {
  return {
    shown: g.nodes.length,
    total: g.totalNodes,
    capped: g.capped,
    orphanCount: g.nodes.filter((n) => n.isOrphan).length,
    jsOnlyCount: g.nodes.filter((n) => n.jsOnly).length,
  };
}

/** Honest coverage: a plain count normally; "Showing N of M pages" whenever the payload is capped. */
export function coverageLabel(g: GraphData): string {
  const shown = g.nodes.length;
  const fmt = (n: number) => n.toLocaleString('en-US');
  if (!g.capped && g.totalNodes <= shown) return `${fmt(shown)} ${shown === 1 ? 'page' : 'pages'}`;
  return `Showing ${fmt(shown)} of ${fmt(g.totalNodes)} pages`;
}

/** Free-tier cap → the honest Pro upsell; null for any other cap reason. */
export function capUpsell(g: Pick<GraphData, 'capReason'>): string | null {
  return g.capReason === 'free_tier' ? 'See your full graph with Pro' : null;
}

/**
 * The honest jsOnly message — a REACHABILITY signal (no static link path), never a claim that the
 * node itself "is JavaScript". Mirrors the js_rendered finding: AI crawlers don't run JS, so a page
 * with no static link path is one they likely can't reach.
 */
export function jsOnlyMessage(count: number): string | null {
  if (count <= 0) return null;
  const subj = count === 1 ? 'page has' : 'pages have';
  const obj = count === 1 ? 'it' : 'them';
  return `${count} ${subj} no static link path — AI crawlers like ChatGPT and Claude likely can't reach ${obj}.`;
}

/** Escape crawled (attacker-controlled) node strings before they reach the canvas tooltip's innerHTML. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
