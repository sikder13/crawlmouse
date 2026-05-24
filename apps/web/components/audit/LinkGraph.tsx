'use client';

import Graph from 'graphology';
import { SigmaContainer, useLoadGraph } from '@react-sigma/core';
import { useEffect, useMemo } from 'react';
import '@react-sigma/core/lib/style.css';

export interface LinkGraphPage { url: string; isOrphan: boolean; depth: number | null }
export interface LinkGraphEdge { from: string; to: string }

interface Props {
  pages: LinkGraphPage[];
  edges: LinkGraphEdge[];
  homepageUrl?: string;
  height?: number;
}

function GraphLoader({ pages, edges, homepageUrl }: { pages: LinkGraphPage[]; edges: LinkGraphEdge[]; homepageUrl?: string }) {
  const loadGraph = useLoadGraph();
  useEffect(() => {
    const g = new Graph();
    pages.forEach((p, i) => {
      g.addNode(p.url, {
        x: Math.cos((i / Math.max(pages.length, 1)) * Math.PI * 2),
        y: Math.sin((i / Math.max(pages.length, 1)) * Math.PI * 2),
        size: p.url === homepageUrl ? 12 : p.isOrphan ? 6 : 8,
        color: p.url === homepageUrl ? '#1a1a18' : p.isOrphan ? '#ff7849' : '#7a9b7e',
        label: '',
      });
    });
    edges.forEach((e) => {
      if (g.hasNode(e.from) && g.hasNode(e.to) && !g.hasEdge(e.from, e.to)) {
        g.addEdge(e.from, e.to, { size: 0.5, color: '#e8e2d4' });
      }
    });
    loadGraph(g);
  }, [pages, edges, homepageUrl, loadGraph]);
  return null;
}

export function LinkGraph({ pages, edges, homepageUrl, height = 480 }: Props) {
  const settings = useMemo(() => ({
    renderEdgeLabels: false,
    defaultEdgeColor: '#e8e2d4',
    defaultNodeColor: '#7a9b7e',
    labelColor: { color: '#1a1a18' },
    labelSize: 12,
  }), []);
  return (
    <div style={{ height }} className="rounded-2xl overflow-hidden border border-oat bg-cream">
      <SigmaContainer style={{ height: '100%', background: 'transparent' }} settings={settings}>
        <GraphLoader pages={pages} edges={edges} homepageUrl={homepageUrl} />
      </SigmaContainer>
    </div>
  );
}
