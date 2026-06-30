import type { ClientAuditV2 } from '@/lib/audit-stream-projection';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { ShareSurface } from '../share/ShareSurface';
import { CureWall } from './CureWall';
import { DiagnosisBanners } from './DiagnosisBanners';
import { FreeFixCard } from './FreeFixCard';
import { GapPanel } from './GapPanel';
import { GradeReveal } from './GradeReveal';
import { LinkGraphSlot } from './LinkGraphSlot';
import { ResultError } from './ResultError';
import { SaveAndMonitorCta } from './SaveAndMonitorCta';

// The conversion arc composed from a ClientAuditV2 (§3/§4), re-weighted (D2) so the eye is guided:
// the grade gauge dominates, the gap and the one free fix lead, the locked cures sit lighter, the
// graph slot is reserved, and the JS/estimate disclosures are quiet and last. Pure render — the live
// stream wires a real ClientAuditV2 at integration; tested here against fixtures.
export function ResultView({
  audit,
  shareUrl,
}: {
  audit: ClientAuditV2;
  shareUrl?: string;
}) {
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
    <div className="space-y-8">
      {/* 1 — the grade: gauge + tier framing + benchmark + impulse share */}
      <GradeReveal
        grade={audit.grade}
        score={audit.score}
        orphanCount={audit.orphanCount}
        avgDepth={audit.avgDepth}
        confidenceBand={audit.confidenceBand}
        achievableGrade={audit.projectedGrade?.projected.grade}
        shareUrl={shareUrl}
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
        <div className="space-y-6">
          {/* 2 — the gap */}
          {audit.projectedGrade && <GapPanel projected={audit.projectedGrade} />}
          {/* 3 — the one free fix: the hero of the free experience */}
          {audit.freeFix && <FreeFixCard freeFix={audit.freeFix} />}
          {/* 4 — the locked cures (lighter weight) */}
          <CureWall audit={audit} />
        </div>
      )}

      {/* 5 — the live link graph (v1.2): the signature visual + the AI-crawler reachability story */}
      <LinkGraphSlot graph={audit.graph} />

      {/* the richer share section */}
      <ShareSurface grade={audit.grade} score={audit.score} shareUrl={shareUrl} />

      {/* STAY — the spine's tail: a signed-out viewer can save + monitor with a free account. Gated
          on the v1.2 `viewerSignedIn` contract field so a signed-in viewer never sees it. */}
      {!audit.viewerSignedIn && <SaveAndMonitorCta />}

      {/* 6 — disclosures: quiet, last */}
      {!cleanSite && audit.findings.length > 0 && (
        <div className="space-y-2">
          <div className="text-overline uppercase text-ink-muted">Notes</div>
          <DiagnosisBanners findings={audit.findings} />
        </div>
      )}
    </div>
  );
}
