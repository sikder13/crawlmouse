'use client';

import { type ReactNode } from 'react';
import { AuditProgress } from '@/components/audit/AuditProgress';
import { GradeCard } from '@/components/ui/GradeCard';
import { Card } from '@/components/ui/Card';
import { FREE_PAGE_CAP, isPassingScore } from '@/lib/limits';
import { useAuditStream, type AuditStream } from '@/lib/use-audit-stream';

interface Side {
  id: string;
  domain: string;
}

type ColumnState =
  | { kind: 'running'; pageCount: number; pageCap: number; status: string }
  | { kind: 'graded'; grade: string; score: number; orphanCount: number; avgDepth: number }
  | { kind: 'ungradable' };

function columnState({ snapshot: s, finished }: AuditStream): ColumnState {
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
          <h2 className="font-display font-bold text-xl text-warning">Couldn’t grade this site</h2>
          <p className="mt-2 text-sm text-ink/70">The crawl didn’t produce a grade — usually a site that blocks crawlers or has no crawlable pages.</p>
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

  const scoreA = stateA.kind === 'graded' ? stateA.score : null;
  const scoreB = stateB.kind === 'graded' ? stateB.score : null;

  // Winner: both graded → higher score (equal = tie, no ring); exactly one graded
  // while the other is terminally ungradable → the graded side wins; still crawling → undecided.
  let winnerId: string | null = null;
  let banner: ReactNode = null;
  if (scoreA != null && scoreB != null) {
    if (scoreA === scoreB) {
      banner = <>Dead heat — both sites scored {scoreA.toFixed(0)}.</>;
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
