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

export function CompareView({ a, b }: { a: Side; b: Side }) {
  const stateA = columnState(useAuditStream(a.id));
  const stateB = columnState(useAuditStream(b.id));

  // Compare on the rounded score the cards actually display, so the banner can never
  // declare a winner while both cards show the same number.
  const scoreA = stateA.kind === 'graded' ? Math.round(stateA.score) : null;
  const scoreB = stateB.kind === 'graded' ? Math.round(stateB.score) : null;

  // Winner: both graded → higher score (equal = tie, no ring); exactly one graded
  // while the other is terminally ungradable → the graded side wins; still crawling → undecided.
  let winnerId: string | null = null;
  let banner: ReactNode = null;
  if (scoreA != null && scoreB != null) {
    if (scoreA === scoreB) {
      banner = <>Dead heat — both sites scored {scoreA}.</>;
    } else {
      const winner = scoreA > scoreB ? a : b;
      winnerId = winner.id;
      banner = <><span className="text-peach">{winner.domain}</span> wins this round.</>;
    }
  } else if (scoreA != null && stateB.kind === 'ungradable') {
    winnerId = a.id;
    banner = <><span className="text-peach">{a.domain}</span> wins — we couldn’t grade {b.domain}.</>;
  } else if (scoreB != null && stateA.kind === 'ungradable') {
    winnerId = b.id;
    banner = <><span className="text-peach">{b.domain}</span> wins — we couldn’t grade {a.domain}.</>;
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
