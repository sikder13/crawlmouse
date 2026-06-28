import type { FixDiagnosis } from '@crawlmouse/types';
import { Card } from '../ui/Card';
import { findingMeta } from './finding-meta';
import { relativeImpactLabel } from './result-logic';

// A visible-but-locked cure: the user sees the SHAPE of what they're missing (the diagnosis +
// relative impact) but NOT the cure. The component only ever receives a FixDiagnosis (FREE data) —
// the prescription is absent from the payload, so there is nothing to leak (§10 / U2). Calm, honest.
export function LockedCureCard({ diagnosis }: { diagnosis: FixDiagnosis }) {
  const meta = findingMeta(diagnosis.category);
  return (
    <Card variant="locked">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-ink">
          {meta.label}: {diagnosis.targetTitle ?? diagnosis.targetUrl}
        </span>
        <span className="shrink-0 font-mono text-caption text-ink-muted">
          {relativeImpactLabel(diagnosis.marginalDelta)} (est.)
        </span>
      </div>
      <p className="mt-1 break-words font-mono text-caption text-ink-muted">{diagnosis.targetUrl}</p>
      <div className="mt-3 flex items-center gap-2 text-caption text-ink-muted">
        <span aria-hidden="true">🔒</span>
        <span>
          Cure + AI action-packet — <span className="font-medium text-ink">Pro</span>
        </span>
      </div>
    </Card>
  );
}
