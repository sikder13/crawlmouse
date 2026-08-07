import type { ClientAuditV2 } from '@/lib/audit-stream-projection';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { AiReadinessSection } from '../ai/AiReadinessSection';
import { ShareSurface } from '../share/ShareSurface';
import { CureWall } from './CureWall';
import { DiagnosisBanners } from './DiagnosisBanners';
import { findingMeta } from './finding-meta';
import { informationalFindings } from './result-logic';
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
  // DERIVED FROM THE PERSISTED DECISION, NEVER FROM `grade == null` (gate 4, R3-NB2). This surface
  // still read the null after the route had been taught not to, which left two hand-synchronised
  // derivations of one concept — the class the branch says it removes. It also left a latent
  // inversion: a row with `refusal.refused === true` and a non-null grade routed `refused` at the
  // route and then fell straight through to the FULL GRADED ARC WITH A LETTER here. Unreachable
  // today (the engine nulls both together) only because the two gates happen to agree.
  const refused = audit.refusal?.refused === true;
  if (refused) {
    // ONE CALL SITE. The five approved bodies are selected in lib/refusal-copy.ts from the persisted
    // trigger list; this renders whichever it returns and decides nothing itself. A surface that
    // hand-assembled its own sentence is a surface that would drift from the other twelve.
    // Drop findings whose copy presumes a verdict (see FindingMeta.assertsVerdict).
    const verdictFreeFindings = audit.findings.filter((f) => !findingMeta(f.category).assertsVerdict);
    // The heading is gated on what DiagnosisBanners will actually render, not on the finding count.
    // Gating on the count rendered "What we did find" above nothing at all, because the banners only
    // draw the informational categories and the rest were filtered or unsupported.
    const renderableFindings = informationalFindings(verdictFreeFindings);
    const copy = refusalCopy({
      triggers: audit.refusal?.triggers ?? [],
      coverage: audit.coverage,
      // EVERY NUMBER NAMED AS ITSELF. Three rounds of the same defect landed here:
      //   gate 3 — `{ fetchedOk: audit.page_count, blocked: null, discovered: null }`, so the copy
      //            had one number and printed it as both figures of "N requests, M refused";
      //   gate 4 — `discovered` was passed and then READ AS `attempted` inside refusalCopy, which
      //            renders "8 requests, 0 refused" for a host we made 3 requests to. `discovered` is
      //            fetched ∪ link targets: it counts URLs we deliberately never requested.
      //
      // `attempted` is the number that sentence means, and it is COMPUTED BY THE ENGINE BUT NEVER
      // PERSISTED — there is no `attempted_count` column, and it is not recoverable from the ones
      // there are (`page_count` counts every fetched page including off-host redirects, while
      // `attempted` counts same-host fetches; `fetchedOk + blocked` omits dead). So it is passed as
      // null — UNKNOWN — and `refusalCopy` omits or downgrades the sentence rather than reaching for
      // the nearest available column, which is the rule this file keeps having to relearn.
      crawl: audit.crawlHealth
        ? {
            fetchedOk: audit.page_count,
            blocked: audit.crawlHealth.blocked,
            discovered: audit.crawlHealth.discovered,
            attempted: null,
          }
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
        {/* The evidence survives the refusal — findings are exactly what "What we did find" renders.
            MINUS any finding whose copy asserts that a verdict EXISTS: `incomplete_crawl` reads "Your
            grade is an estimate until the whole site is crawled", which is true on a graded partial
            audit and false four lines under a no-grade label. Filtered by the FindingMeta flag rather
            than by category here, so the next such finding is excluded the day it is written. */}
        {renderableFindings.length > 0 && (
          <div className="mt-6 space-y-2 text-left">
            <div className="text-overline uppercase text-ink-muted">What we did find</div>
            <DiagnosisBanners findings={renderableFindings} />
          </div>
        )}
      </Card>
    );
  }

  // A NULL VERDICT WITH NO REFUSAL PAYLOAD IS A COMPUTE FAILURE, NOT A WITHHELD ONE — the second half
  // of separating the two meanings of a null grade. A pre-migration row, or a run where grading threw,
  // reaches here with `grade == null` and `refusal == null`; it must NOT be handed the Stage 4 copy
  // (which would tell the owner we made a deliberate honesty decision we never made), and it must not
  // build the graded arc from nulls. The route sends these to its own error surface, so this is the
  // component refusing to depend on the route agreeing with it.
  if (audit.grade == null || audit.score == null) {
    return <ResultError failureCategory={audit.failureCategory ?? 'internal'} />;
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
