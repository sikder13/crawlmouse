'use client';

import { type ReactNode } from 'react';
import { AuditProgress } from '@/components/audit/AuditProgress';
import { GradeCard } from '@/components/ui/GradeCard';
import { Card } from '@/components/ui/Card';
import { FREE_PAGE_CAP, isPassingScore } from '@/lib/limits';
import { useAuditStream, type AuditStream } from '@/lib/use-audit-stream';
import { NO_GRADE_EXPLANATION, NO_GRADE_LABEL } from '@/lib/refusal-copy';

interface Side {
  id: string;
  domain: string;
}

/** Exported so SPEC 5.1a Stage 4's surface proof can assert on the DECISION rather than on the
 *  rendered markup — this value is what the column is built from. */
export type ColumnState =
  | { kind: 'running'; pageCount: number; pageCap: number; status: string }
  | { kind: 'graded'; grade: string; score: number; orphanCount: number; avgDepth: number }
  | { kind: 'ungradable' };

export function columnState({ snapshot: s, finished }: AuditStream): ColumnState {
  // Wait for the terminal `done` event before showing a grade: the interim `progress`
  // event flips status to 'completed' before orphanCount/avgDepth arrive, so rendering
  // early would flash zeros on the headline card.
  if (finished && s?.status === 'completed' && s.grade && s.score != null) {
    return { kind: 'graded', grade: s.grade, score: s.score, orphanCount: s.orphanCount ?? 0, avgDepth: s.avgDepth ?? 0 };
  }
  if (finished && (s?.status === 'failed' || s?.status === 'completed')) {
    return { kind: 'ungradable' };
  }
  return { kind: 'running', pageCount: s?.page_count ?? 0, pageCap: s?.settings?.pageCap ?? FREE_PAGE_CAP, status: s?.status ?? 'pending' };
}

function Column({ side, state, isWinner }: { side: Side; state: ColumnState; isWinner: boolean }) {
  return (
    <div className={`rounded-3xl transition-all ${isWinner ? 'ring-2 ring-sage ring-offset-4 ring-offset-cream' : ''}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="font-mono text-sm break-all">{side.domain}</div>
        {isWinner && <span className="text-xs font-semibold uppercase tracking-wider text-sage shrink-0 ml-2">Winner</span>}
      </div>
      {state.kind === 'graded' ? (
        <GradeCard
          grade={state.grade}
          score={state.score}
          orphanCount={state.orphanCount}
          avgDepth={state.avgDepth}
          passing={isPassingScore(state.score)}
        />
      ) : state.kind === 'ungradable' ? (
        <Card>
          {/* SPEC 5.1a Stage 4 — states only what happened. It previously guessed at a cause
              ("usually a site that blocks crawlers or has no crawlable pages"), which is one trigger
              of four and false for the rest: a fully crawled four-page site was read completely and
              blocks nothing. Muted, never the warning tone — a refusal is not a failing grade. */}
          <h2 className="font-display font-bold text-xl text-ink">{NO_GRADE_LABEL}</h2>
          <p className="mt-2 text-sm text-ink/70">{NO_GRADE_EXPLANATION}</p>
        </Card>
      ) : (
        <AuditProgress pageCount={state.pageCount} pageCap={state.pageCap} status={state.status} />
      )}
    </div>
  );
}

/**
 * SPEC 5.1a Stage 4 — who, if anyone, won. Exported and PURE so the composed outcome can be asserted
 * directly; the surface proof previously stopped at `columnState` and never reached this decision,
 * which is the seam the defect lived in (gate 4 / B3).
 */
export type CompareOutcome =
  | { kind: 'undecided' }
  | { kind: 'tie'; score: number }
  | { kind: 'winner'; winnerId: string; winnerDomain: string }
  | { kind: 'one-sided'; gradedDomain: string; ungradedDomain: string };

export function compareOutcome(stateA: ColumnState, stateB: ColumnState, a: Side, b: Side): CompareOutcome {
  // Compare on the rounded score the cards actually display, so the banner can never declare a
  // winner while both cards show the same number.
  const scoreA = stateA.kind === 'graded' ? Math.round(stateA.score) : null;
  const scoreB = stateB.kind === 'graded' ? Math.round(stateB.score) : null;

  if (scoreA != null && scoreB != null) {
    if (scoreA === scoreB) return { kind: 'tie', score: scoreA };
    const winner = scoreA > scoreB ? a : b;
    return { kind: 'winner', winnerId: winner.id, winnerDomain: winner.domain };
  }

  // EXACTLY ONE GRADED IS NOT A VICTORY — gate 4 / B3. This used to award the win to the graded side
  // and ring it: "yourshop.com wins — we couldn't grade theirsite.com", four lines above the other
  // column saying "We didn't have enough evidence to publish a grade for this site." One screen
  // stating we had no evidence, and awarding a win BECAUSE of it.
  //
  // Stage 4's whole rule is that a site we could not read is not a bad site, and 5.1a makes the
  // collision systematic rather than rare: `no_observed_links` fires on every JS-rendered site, so
  // every Framer/Webflow-SPA comparison would permanently publish a defeat that measures our static
  // crawler rather than their linking. No winner, no ring — and we say which side we could grade,
  // because that is the part we actually know.
  if (scoreA != null && stateB.kind === 'ungradable') {
    return { kind: 'one-sided', gradedDomain: a.domain, ungradedDomain: b.domain };
  }
  if (scoreB != null && stateA.kind === 'ungradable') {
    return { kind: 'one-sided', gradedDomain: b.domain, ungradedDomain: a.domain };
  }
  return { kind: 'undecided' };
}

export function CompareView({ a, b }: { a: Side; b: Side }) {
  const stateA = columnState(useAuditStream(a.id));
  const stateB = columnState(useAuditStream(b.id));

  const outcome = compareOutcome(stateA, stateB, a, b);
  const winnerId: string | null = outcome.kind === 'winner' ? outcome.winnerId : null;
  let banner: ReactNode = null;
  if (outcome.kind === 'tie') {
    banner = <>Dead heat — both sites scored {outcome.score}.</>;
  } else if (outcome.kind === 'winner') {
    banner = <><span className="text-peach">{outcome.winnerDomain}</span> wins this round.</>;
  } else if (outcome.kind === 'one-sided') {
    banner = (
      <>
        We could only grade <span className="text-peach">{outcome.gradedDomain}</span> — there wasn’t
        enough evidence to publish a grade for {outcome.ungradedDomain}, so there’s no comparison to make.
      </>
    );
  }

  return (
    <div className="space-y-6">
      {banner && (
        <Card className="text-center !rounded-3xl bg-ink text-cream">
          <p className="font-display font-bold text-2xl">{banner}</p>
          <p className="text-cream/60 text-sm mt-1">Better internal linking means search engines crawl more of your pages.</p>
        </Card>
      )}
      <div className="grid md:grid-cols-2 gap-6 items-start">
        <Column side={a} state={stateA} isWinner={winnerId === a.id} />
        <Column side={b} state={stateB} isWinner={winnerId === b.id} />
      </div>
    </div>
  );
}
