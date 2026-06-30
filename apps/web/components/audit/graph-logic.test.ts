import { describe, it, expect } from 'vitest';
import {
  capUpsell,
  coverageLabel,
  depthColor,
  escapeHtml,
  graphSummary,
  jsOnlyMessage,
  nodeRadius,
  nodeReason,
  nodeStyle,
} from './graph-logic';
import { BRAND } from '../../lib/brand';
import type { GraphData, GraphNode } from '../../lib/contract-v1_2';

const node = (over: Partial<GraphNode> = {}): GraphNode => ({
  id: 'x',
  url: 'x',
  title: null,
  depth: 1,
  isHomepage: false,
  isOrphan: false,
  pagerank: 0.1,
  jsOnly: false,
  inboundCount: 1,
  outboundCount: 1,
  ...over,
});

describe('graph-logic', () => {
  it('depthColor: homepage (0) is the darkest (ink); deeper is lighter; clamps; null → muted', () => {
    expect(depthColor(0)).toBe(BRAND.ink);
    expect(depthColor(1)).not.toBe(depthColor(0));
    expect(depthColor(5)).not.toBe(depthColor(0));
    expect(depthColor(99)).toBe(depthColor(5)); // clamps at the end of the ramp
    expect(typeof depthColor(null)).toBe('string'); // unreachable → a defined (muted) color
  });

  it('nodeRadius: clamps 0..1, larger pagerank → larger radius, within [min,max]', () => {
    expect(nodeRadius(0)).toBeLessThan(nodeRadius(1));
    expect(nodeRadius(-5)).toBe(nodeRadius(0)); // clamp low
    expect(nodeRadius(5)).toBe(nodeRadius(1)); // clamp high
    expect(nodeRadius(1)).toBeLessThanOrEqual(14);
    expect(nodeRadius(0)).toBeGreaterThanOrEqual(3);
  });

  it('nodeStyle: jsOnly → dashed peach (detached); orphan → solid peach; homepage → ink + ring', () => {
    expect(nodeStyle(node({ jsOnly: true })).dashed).toBe(true);
    expect(nodeStyle(node({ jsOnly: true })).stroke).toBe(BRAND.peach);
    expect(nodeStyle(node({ isOrphan: true })).fill).toBe(BRAND.peach);
    expect(nodeStyle(node({ isOrphan: true })).dashed).toBe(false);
    // jsOnly wins over orphan when both (more specific AI signal)
    expect(nodeStyle(node({ isOrphan: true, jsOnly: true })).dashed).toBe(true);
    const home = nodeStyle(node({ isHomepage: true, depth: 0 }));
    expect(home.fill).toBe(BRAND.ink);
    expect(home.stroke).toBe(BRAND.ink);
  });

  it('graphSummary counts orphans + jsOnly + shown/total', () => {
    const g: GraphData = {
      nodes: [node({ isHomepage: true, depth: 0 }), node({ isOrphan: true }), node({ isOrphan: true, jsOnly: true })],
      edges: [],
      totalNodes: 10,
      totalEdges: 0,
      capped: true,
      capReason: 'free_tier',
    };
    const s = graphSummary(g);
    expect(s.shown).toBe(3);
    expect(s.total).toBe(10);
    expect(s.orphanCount).toBe(2);
    expect(s.jsOnlyCount).toBe(1);
  });

  it('coverageLabel: plain count when full; honest "Showing N of M" when capped', () => {
    const full: GraphData = { nodes: [node(), node()], edges: [], totalNodes: 2, totalEdges: 0, capped: false, capReason: 'none' };
    expect(coverageLabel(full)).toBe('2 pages');
    const capped: GraphData = { nodes: Array.from({ length: 150 }, () => node()), edges: [], totalNodes: 1240, totalEdges: 0, capped: true, capReason: 'free_tier' };
    expect(coverageLabel(capped)).toBe('Showing 150 of 1,240 pages');
  });

  it('capUpsell: free_tier → Pro upsell; otherwise null', () => {
    expect(capUpsell({ capReason: 'free_tier' })).toContain('Pro');
    expect(capUpsell({ capReason: 'readability' })).toBeNull();
    expect(capUpsell({ capReason: 'none' })).toBeNull();
  });

  it('jsOnlyMessage: honest reachability framing (AI crawlers, "static link path"), NOT "this page is JavaScript"', () => {
    const msg = jsOnlyMessage(3) ?? '';
    expect(msg.toLowerCase()).toContain('ai crawler');
    expect(msg.toLowerCase()).toContain('static link path');
    expect(msg).toMatch(/ChatGPT|Claude/);
    expect(msg.toLowerCase()).not.toContain('this page is javascript');
    expect(jsOnlyMessage(0)).toBeNull();
  });

  it('nodeReason: jsOnly → AI reachability; orphan; homepage; buried (depth>3); else ok; jsOnly beats orphan', () => {
    expect(nodeReason(node({ jsOnly: true })).kind).toBe('jsOnly');
    expect(nodeReason(node({ jsOnly: true })).detail.toLowerCase()).toContain('static link path');
    expect(nodeReason(node({ isOrphan: true })).kind).toBe('orphan');
    expect(nodeReason(node({ isHomepage: true, depth: 0 })).kind).toBe('homepage');
    expect(nodeReason(node({ depth: 6 })).kind).toBe('buried');
    expect(nodeReason(node({ depth: 6 })).detail).toContain('6 clicks');
    expect(nodeReason(node({ depth: 2 })).kind).toBe('ok');
    expect(nodeReason(node({ isOrphan: true, jsOnly: true })).kind).toBe('jsOnly'); // priority
  });

  it('escapeHtml neutralizes crawled markup for the canvas tooltip', () => {
    expect(escapeHtml('<script>alert(1)</script>')).not.toContain('<script>');
    expect(escapeHtml('a & b "q"')).toBe('a &amp; b &quot;q&quot;');
  });
});
