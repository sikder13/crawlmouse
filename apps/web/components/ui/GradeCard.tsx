import { Badge } from './Badge';
import { Card } from './Card';

interface Props {
  grade: string; // 'A' | 'A-' | ... | 'F'
  score: number; // 0..100
  orphanCount: number;
  avgDepth: number;
  passing: boolean; // true if score >= 60
}

// Props are unchanged from the legacy card so the public report (/r/[slug], non-owned) renders
// identically in structure. The elevation is visual only: lg card size (no !important hacks),
// type-scale tokens, and AA-safe text colors (sage/peach text on white fail AA — see contrast.ts).
export function GradeCard({ grade, score, orphanCount, avgDepth, passing }: Props) {
  return (
    <Card size="lg">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <div className="text-overline uppercase text-ink-muted">Grade</div>
          <div className="mt-1 font-display text-display leading-none">{grade}</div>
          <div className="mt-1 font-mono text-caption font-semibold text-ink-muted">{score.toFixed(0)} / 100</div>
        </div>
        <Badge tone={passing ? 'sage' : 'peach'}>{passing ? 'Passing' : 'Needs work'}</Badge>
      </div>
      <div className="grid grid-cols-2 gap-3 border-t border-dashed border-oat pt-3">
        <div>
          <div className="font-mono text-2xl font-bold text-accent-text">{orphanCount}</div>
          <div className="text-caption text-ink-muted">orphan pages</div>
        </div>
        <div>
          <div className="font-mono text-2xl font-bold text-ink">{avgDepth.toFixed(1)}</div>
          <div className="text-caption text-ink-muted">avg click depth</div>
        </div>
      </div>
    </Card>
  );
}
