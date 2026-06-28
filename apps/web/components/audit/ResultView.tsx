import type { ClientAuditV2 } from '@/lib/audit-stream-projection';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { ShareSurface } from '../share/ShareSurface';
import { CureWall } from './CureWall';
import { DiagnosisBanners } from './DiagnosisBanners';
import { FreeFixCard } from './FreeFixCard';
import { GapPanel } from './GapPanel';
import { GradeReveal } from './GradeReveal';
import { ResultError } from './ResultError';

// The conversion arc composed from a ClientAuditV2 (§3/§4): build → reveal → gap → free fix → wall,
// plus the share moment and the comprehension layer (baked into each component). Pure render — the
// live stream wires a real ClientAuditV2 in at integration; tested here against fixtures.
export function ResultView({ audit, shareUrl }: { audit: ClientAuditV2; shareUrl?: string }) {
  if (audit.status === 'failed') {
    return <ResultError failureCategory={audit.failureCategory ?? 'internal'} />;
  }

  if (audit.grade == null || audit.score == null) {
    return (
      <Card variant="raised" className="text-center">
        <div className="text-overline uppercase text-ink-muted">Not enough to grade</div>
        <h3 className="mt-2 font-display text-h3">We couldn&rsquo;t grade this site yet</h3>
        <p className="mx-auto mt-2 max-w-prose text-body text-ink-muted">
          We reached too few pages to score your internal linking confidently. Try a site with more
          interlinked pages, or re-run the audit.
        </p>
      </Card>
    );
  }

  const ledgerCount = audit.projectedGrade?.ledger.length ?? 0;
  const cleanSite = ledgerCount === 0 && audit.findings.length === 0;

  return (
    <div className="space-y-6">
      <GradeReveal
        grade={audit.grade}
        score={audit.score}
        orphanCount={audit.orphanCount}
        avgDepth={audit.avgDepth}
        confidenceBand={audit.confidenceBand}
      />

      {cleanSite ? (
        <Card variant="raised" className="text-center">
          <Badge tone="success">Clean bill of health</Badge>
          <h3 className="mt-3 font-display text-h3">Your internal linking is in great shape 🎉</h3>
          <p className="mx-auto mt-2 max-w-prose text-body text-ink-muted">
            We didn&rsquo;t find orphan pages, buried pages, or weak anchors worth flagging. Keep it up —
            re-audit after big content changes.
          </p>
        </Card>
      ) : (
        <>
          {audit.projectedGrade && <GapPanel projected={audit.projectedGrade} />}
          {audit.freeFix && <FreeFixCard freeFix={audit.freeFix} />}
          <CureWall audit={audit} />
          <DiagnosisBanners findings={audit.findings} />
        </>
      )}

      <ShareSurface audit={audit} shareUrl={shareUrl} />
    </div>
  );
}
