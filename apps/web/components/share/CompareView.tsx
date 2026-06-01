'use client';

import { AuditProgress } from '@/components/audit/AuditProgress';
import { GradeCard } from '@/components/ui/GradeCard';
import { Card } from '@/components/ui/Card';
import { FREE_PAGE_CAP, isPassingScore } from '@/lib/limits';
import { useAuditStream, type AuditSnapshot } from '@/lib/use-audit-stream';

interface Side {
  id: string;
  domain: string;
}

function isGraded(s: AuditSnapshot | null): s is AuditSnapshot & { grade: string; score: number } {
  return !!s && s.status === 'completed' && !!s.grade && s.score != null;
}

function Column({ side, snapshot, isWinner }: { side: Side; snapshot: AuditSnapshot | null; isWinner: boolean }) {
  const completed = snapshot?.status === 'completed';
  const failed = snapshot?.status === 'failed';
  const graded = isGraded(snapshot);
  const pageCap = snapshot?.settings?.pageCap ?? FREE_PAGE_CAP;

  return (
    <div className={`rounded-3xl transition-all ${isWinner ? 'ring-2 ring-sage ring-offset-4 ring-offset-cream' : ''}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="font-mono text-sm break-all">{side.domain}</div>
        {isWinner && <span className="text-xs font-semibold uppercase tracking-wider text-sage shrink-0 ml-2">Winner</span>}
      </div>
      {graded ? (
        <GradeCard
          grade={snapshot.grade}
          score={snapshot.score}
          orphanCount={snapshot.orphanCount ?? 0}
          avgDepth={snapshot.avgDepth ?? 0}
          passing={isPassingScore(snapshot.score)}
        />
      ) : failed || (completed && !graded) ? (
        <Card>
          <h2 className="font-display font-bold text-xl text-warning">Couldn’t grade this site</h2>
          <p className="mt-2 text-sm text-ink/70">The crawl didn’t produce a grade — usually a site that blocks crawlers or has no crawlable pages.</p>
        </Card>
      ) : (
        <AuditProgress pageCount={snapshot?.page_count ?? 0} pageCap={pageCap} status={snapshot?.status ?? 'pending'} />
      )}
    </div>
  );
}

export function CompareView({ a, b }: { a: Side; b: Side }) {
  const sa = useAuditStream(a.id);
  const sb = useAuditStream(b.id);

  const bothGraded = isGraded(sa) && isGraded(sb);
  const tie = bothGraded && sa.score === sb.score;
  // On a tie there's no winner ring; otherwise the higher score wins.
  const winnerId = bothGraded && !tie ? (sa.score > sb.score ? a.id : b.id) : null;
  const winnerDomain = winnerId === a.id ? a.domain : winnerId === b.id ? b.domain : null;

  return (
    <div className="space-y-6">
      {bothGraded && (
        <Card className="text-center !rounded-3xl bg-ink text-cream">
          {tie ? (
            <p className="font-display font-bold text-2xl">Dead heat — both sites scored {sa.score.toFixed(0)}.</p>
          ) : (
            <p className="font-display font-bold text-2xl">
              <span className="text-peach">{winnerDomain}</span> wins this round.
            </p>
          )}
          <p className="text-cream/60 text-sm mt-1">Better internal linking means search engines crawl more of your pages.</p>
        </Card>
      )}
      <div className="grid md:grid-cols-2 gap-6 items-start">
        <Column side={a} snapshot={sa} isWinner={winnerId === a.id} />
        <Column side={b} snapshot={sb} isWinner={winnerId === b.id} />
      </div>
    </div>
  );
}
