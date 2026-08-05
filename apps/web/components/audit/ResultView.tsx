import type { ClientAuditV2 } from '@/lib/audit-stream-projection';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { AiReadinessSection } from '../ai/AiReadinessSection';
import { ShareSurface } from '../share/ShareSurface';
import { CureWall } from './CureWall';
import { DiagnosisBanners } from './DiagnosisBanners';
import { FreeFixCard } from './FreeFixCard';
import { GapPanel } from './GapPanel';
import { GradeReveal } from './GradeReveal';
import { LinkGraphSlot } from './LinkGraphSlot';
import { ResultError } from './ResultError';
import { SaveAndMonitorCta } from './SaveAndMonitorCta';
import { NO_GRADE_LABEL, refusalCopy } from '@/lib/refusal-copy';

// The conversion arc composed from a ClientAuditV2 (§3/§4), re-weighted (D2) so the eye is guided:
// the grade gauge dominates, the gap and the one free fix lead, the locked cures sit lighter, the
// graph slot is reserved, and the JS/estimate disclosures are quiet and last. Pure render — the live
// stream wires a real ClientAuditV2 at integration; tested here against fixtures.
export function ResultView({ audit }: { audit: ClientAuditV2 }) {
  if (audit.status === 'failed') {
    return <ResultError failureCategory={audit.failureCategory ?? 'internal'} />;
  }

  // SPEC 5.1a Stage 4 — the refusal gate withheld a verdict. This returns BEFORE GradeReveal and
  // ShareSurface, so no gauge, letter, score or share text is constructed at all.
  //
  // The copy no longer claims a CAUSE. It read "We reached too few pages to score your internal
  // linking confidently. Try a site with more interlinked pages" — one of four triggers stated as if
  // it were all of them, and outright false for the others: a fully crawled four-page brochure was
  // read completely, and a 79-page site with no observed links was not short of pages. A falsehood
  // inside the honesty gate is the worst possible place for one.
  //
  // No Pro upsell either — none of the triggers is solved by a bigger crawl budget, so suggesting one
  // would be a lie. Since `audits.refusal` persists (20260804000001) the five approved trigger-specific
  // bodies are selected in lib/refusal-copy.ts and rendered here; a pre-migration row has no triggers
  // and falls back to the generic sentence rather than having a reason invented for it.
  if (audit.grade == null || audit.score == null) {
    // ONE CALL SITE. The five approved bodies are selected in lib/refusal-copy.ts from the persisted
    // trigger list; this renders whichever it returns and decides nothing itself. A surface that
    // hand-assembled its own sentence is a surface that would drift from the other twelve.
    const copy = refusalCopy({
      triggers: audit.refusal?.triggers ?? [],
      coverage: audit.coverage,
      crawl: audit.crawlHealth
        ? { fetchedOk: audit.page_count, blocked: null, discovered: null }
        : null,
      siteUrl: null,
    });
    return (
      <Card variant="raised" className="text-center">
        {/* Muted, never the warning tone: a refusal is an absence of a verdict, not a failing one. */}
        <div className="text-overline uppercase text-ink-muted">{NO_GRADE_LABEL}</div>
        <h3 className="mt-2 font-display text-h3">{copy.headline}</h3>
        {copy.body.map((para) => (
          <p key={para} className="mx-auto mt-2 max-w-prose text-body text-ink-muted">{para}</p>
        ))}
        {copy.next && (
          <p className="mx-auto mt-3 max-w-prose text-body text-ink">{copy.next}</p>
        )}
        {/* The evidence survives the refusal — findings are exactly what "What we did find" renders. */}
        {audit.findings.length > 0 && (
          <div className="mt-6 space-y-2 text-left">
            <div className="text-overline uppercase text-ink-muted">What we did find</div>
            <DiagnosisBanners findings={audit.findings} />
          </div>
        )}
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
        auditId={audit.id}
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

      {/* 5b — the sibling AI/agent-readiness score (SPEC 05). Rendered only when the v2 engine produced it;
          the owner-scoped Pro artifacts inside are gated by data presence (whatAiSees/aiPackets != null). */}
      {audit.aiReadiness && <AiReadinessSection aiReadiness={audit.aiReadiness} auditId={audit.id} />}

      {/* the richer share section */}
      <ShareSurface grade={audit.grade} score={audit.score} auditId={audit.id} />

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
