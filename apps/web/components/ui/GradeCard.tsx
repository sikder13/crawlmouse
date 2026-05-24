import { Badge } from './Badge';
import { Card } from './Card';

interface Props {
  grade: string;             // 'A' | 'A-' | ... | 'F'
  score: number;             // 0..100
  orphanCount: number;
  avgDepth: number;
  passing: boolean;          // true if score >= 60
}

export function GradeCard({ grade, score, orphanCount, avgDepth, passing }: Props) {
  return (
    <Card className="!p-7 !rounded-3xl">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-ink/60">Grade</div>
          <div className="font-display font-bold text-6xl leading-none mt-1">{grade}</div>
          <div className="font-mono text-sm font-semibold text-sage mt-1">{score.toFixed(0)} / 100</div>
        </div>
        <Badge tone={passing ? 'sage' : 'peach'}>{passing ? 'Passing' : 'Needs work'}</Badge>
      </div>
      <div className="border-t border-dashed border-oat pt-3 grid grid-cols-2 gap-3">
        <div>
          <div className="font-mono text-2xl font-bold text-peach">{orphanCount}</div>
          <div className="text-xs text-ink/60">orphan pages</div>
        </div>
        <div>
          <div className="font-mono text-2xl font-bold text-ink">{avgDepth.toFixed(1)}</div>
          <div className="text-xs text-ink/60">avg click depth</div>
        </div>
      </div>
    </Card>
  );
}
