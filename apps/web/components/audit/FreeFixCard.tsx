import type { FreeFix } from '@crawlmouse/types';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { Explainer } from '../ui/Explainer';
import { ActionPacketCopy } from './ActionPacketCopy';
import { findingMeta } from './finding-meta';
import { relativeImpactLabel } from './result-logic';

// The one complete, FREE cure shown end-to-end — the "taste" (§4). All strings are crawled
// (attacker-controlled): rendered as JSX text (auto-escaped); URLs shown as text, never an href;
// the packet body in a <pre> (escaped). No dangerouslySetInnerHTML anywhere (U12).
export function FreeFixCard({ freeFix }: { freeFix: FreeFix }) {
  const { diagnosis, prescription } = freeFix;
  const meta = findingMeta(diagnosis.category);
  return (
    <Card variant="raised">
      <div className="flex items-center justify-between gap-3">
        <Badge tone="success">Free fix unlocked</Badge>
        <span className="font-mono text-caption text-ink-muted">
          {relativeImpactLabel(diagnosis.marginalDelta)} (est.)
        </span>
      </div>

      <h3 className="mt-3 font-display text-h3">
        {meta.label}: {diagnosis.targetTitle ?? diagnosis.targetUrl}
      </h3>
      <p className="mt-1 break-words font-mono text-caption text-ink-muted">{diagnosis.targetUrl}</p>
      <p className="mt-2 text-body text-ink-muted">{diagnosis.rationale}</p>
      <Explainer className="mt-2" summary={`What is ${meta.label.toLowerCase()}?`}>
        <p>
          {meta.what} {meta.why}
        </p>
      </Explainer>

      <div className="mt-4">
        <div className="text-overline uppercase text-ink-muted">Add these internal links</div>
        <ul className="mt-2 space-y-2">
          {prescription.suggestedLinks.map((link, i) => (
            <li key={`${link.fromUrl}:${i}`} className="text-body">
              From <span className="font-medium text-ink">{link.fromTitle ?? link.fromUrl}</span> with anchor{' '}
              <span className="rounded bg-oat px-1.5 py-0.5 font-mono text-caption text-ink">{link.anchorText}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="text-overline uppercase text-ink-muted">Action packet</div>
          <ActionPacketCopy packet={prescription.actionPacket} fixId={prescription.fixId} />
        </div>
        <pre className="overflow-x-auto rounded-card bg-cream p-3 text-caption leading-relaxed text-ink">
          {prescription.actionPacket.body}
        </pre>
      </div>
    </Card>
  );
}
