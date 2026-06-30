import type { GraphNode } from '@crawlmouse/types';
import { nodeReason } from './graph-logic';

// A clicked node's detail panel, rendered over the canvas by LinkGraph — the click-to-explain that
// turns the graph into a tool. Pure + presentational → unit-tested. Crawled title/url are rendered as
// auto-escaped text (never an href), so attacker-controlled strings can't inject (U12).
export function NodeDetail({ node, onClose }: { node: GraphNode; onClose?: () => void }) {
  const reason = nodeReason(node);
  // The two "needs attention" reasons (orphan / jsOnly) + buried read in the accent; homepage/ok stay muted.
  const tone = reason.kind === 'ok' || reason.kind === 'homepage' ? 'text-ink-muted' : 'text-accent-text';
  return (
    <div className="rounded-card border border-oat bg-surface-raised p-3 shadow-raised">
      <div className="flex items-start justify-between gap-3">
        <div className={`text-overline uppercase ${tone}`}>{reason.label}</div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close detail"
            className="-mt-1 text-body leading-none text-ink-muted hover:text-ink"
          >
            ×
          </button>
        )}
      </div>
      <div className="mt-1 break-words font-medium text-ink">{node.title ?? node.url}</div>
      {node.title && <div className="break-words font-mono text-caption text-ink-muted">{node.url}</div>}
      <p className="mt-2 text-caption text-ink-muted">{reason.detail}</p>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-caption text-ink-muted">
        <span>{node.inboundCount} in</span>
        <span>{node.outboundCount} out</span>
        {node.depth != null && <span>depth {node.depth}</span>}
      </div>
    </div>
  );
}
