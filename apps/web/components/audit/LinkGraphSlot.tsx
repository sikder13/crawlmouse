'use client';

import { useEffect, useState, type ComponentType } from 'react';
import Link from 'next/link';
import { BRAND } from '../../lib/brand';
import type { GraphData } from '@crawlmouse/types';
import { Card } from '../ui/Card';
import { capUpsell, coverageLabel, graphSummary, jsOnlyMessage } from './graph-logic';

// The link-graph section. The canvas (LinkGraph) is client-only, loaded via a dynamic import AFTER
// mount, so the server render + the node-env unit tests never pull in react-force-graph. The header,
// honest coverage ("Showing N of M"), legend, the orphan/AI-crawler summary, and the cap upsell all
// render server-side — so the orphan + AI-readiness story is accessible and never canvas-only.

function GraphSkeleton() {
  return (
    <div
      className="flex items-center justify-center rounded-card bg-cream"
      style={{ height: 340 }}
      aria-hidden="true"
    >
      <span className="text-caption text-ink-muted">Drawing your link graph…</span>
    </div>
  );
}

export function LinkGraphSlot({ graph }: { graph: GraphData | null }) {
  const [Canvas, setCanvas] = useState<ComponentType<{ graph: GraphData }> | null>(null);
  useEffect(() => {
    let active = true;
    import('./LinkGraph')
      .then((m) => {
        if (active) setCanvas(() => m.LinkGraph);
      })
      .catch(() => {
        /* keep the skeleton if the chunk fails to load */
      });
    return () => {
      active = false;
    };
  }, []);

  // null while the crawl is still building / on error, or an empty graph → a calm reserved placeholder.
  if (!graph || graph.nodes.length === 0) {
    return (
      <Card className="border-dashed text-center">
        <div className="text-overline uppercase text-ink-muted">Live link graph</div>
        <div className="mt-3 flex h-40 items-center justify-center rounded-card bg-cream">
          <span className="text-caption text-ink-muted">Your link graph appears here once the crawl completes.</span>
        </div>
      </Card>
    );
  }

  const summary = graphSummary(graph);
  const coverage = coverageLabel(graph);
  const upsell = capUpsell(graph);
  const jsMsg = jsOnlyMessage(summary.jsOnlyCount);

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-overline uppercase text-ink-muted">Your link graph</div>
        <div className="text-caption text-ink-muted">{coverage}</div>
      </div>

      <div className="mt-3">{Canvas ? <Canvas graph={graph} /> : <GraphSkeleton />}</div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-caption text-ink-muted">
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: BRAND.ink }} aria-hidden="true" />
          Homepage → deeper
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: BRAND.peach }} aria-hidden="true" />
          Orphan (no inbound links)
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full border border-dashed"
            style={{ borderColor: BRAND.peach, backgroundColor: BRAND.peachLight }}
            aria-hidden="true"
          />
          Reachable only via JavaScript
        </li>
      </ul>

      {(summary.orphanCount > 0 || jsMsg) && (
        <p className="mt-3 text-caption text-ink-muted">
          {summary.orphanCount > 0 && (
            <span>
              {summary.orphanCount} orphan {summary.orphanCount === 1 ? 'page' : 'pages'} with no inbound internal links.{' '}
            </span>
          )}
          {jsMsg && <span>{jsMsg}</span>}
        </p>
      )}

      {upsell && (
        <p className="mt-2 text-caption">
          <Link href={{ pathname: '/pricing' }} className="font-medium text-ink underline">
            {upsell} →
          </Link>
        </p>
      )}
    </Card>
  );
}
