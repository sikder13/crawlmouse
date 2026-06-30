import type { ProjectedGrade } from '@crawlmouse/types';
import { Card } from '../ui/Card';
import { Explainer } from '../ui/Explainer';
import { gradeGap } from './result-logic';

/** The gap — "you're a C, you could be a B+" — the single most motivating beat (§3). The
 *  disclaimer is rendered verbatim; per-fix impacts are shown relative and never summed. */
export function GapPanel({ projected }: { projected: ProjectedGrade }) {
  const gap = gradeGap(projected);
  // Engine scores are 2-decimal floats — round at the render boundary so the gap never shows
  // "+12.430000000000007". The gain is the difference of the displayed (rounded) scores, so the
  // three numbers stay internally consistent.
  const curScore = Math.round(gap.current.score);
  const projScore = Math.round(gap.projected.score);
  const gain = projScore - curScore;
  return (
    <Card variant="raised">
      <div className="text-overline uppercase text-ink-muted">The opportunity</div>
      <p className="mt-2 font-display text-h2 leading-tight">
        You&rsquo;re a {gap.current.grade} — you could be a{' '}
        <span className="text-accent-text">{gap.projected.grade}</span>
      </p>
      <p className="mt-2 text-body text-ink-muted">
        Fixing what&rsquo;s below could lift your score from{' '}
        <span className="font-mono text-ink">{curScore}</span> to about{' '}
        <span className="font-mono font-semibold text-ink">{projScore}</span>{' '}
        <span className="font-mono font-semibold text-ink">(+{gain})</span>.
      </p>
      <p className="mt-3 text-caption text-ink-muted">{projected.disclaimer}</p>
      <p className="mt-2 text-caption text-ink-muted">
        This is a projected <strong className="font-medium text-ink">grade</strong>, not a traffic
        forecast. Structure fixes show in your grade right away; search engines take weeks to recrawl
        and re-rank.
      </p>
      <Explainer className="mt-2" summary="How is this estimated?">
        <p>
          We simulate fixing the issues below and re-grade the result once. Each fix&rsquo;s impact is
          shown on its own — the impacts are relative and don&rsquo;t add up to the total.
        </p>
      </Explainer>
    </Card>
  );
}
