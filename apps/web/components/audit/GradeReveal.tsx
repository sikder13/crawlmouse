import type { ConfidenceBand } from '@crawlmouse/types';
import { Badge } from '../ui/Badge';
import { Explainer } from '../ui/Explainer';
import { GradeCard } from '../ui/GradeCard';
import { estimateBasisText } from './result-logic';

interface Props {
  grade: string;
  score: number;
  orphanCount: number;
  avgDepth: number | null;
  confidenceBand?: ConfidenceBand | null;
}

// The grade reveal — the wow (§3). Adds an estimate form when the crawl was partial (§8), a
// screen-reader live-region announce (§9), and a plain-language "what your grade measures"
// (Part 2/3). The animation degrades under prefers-reduced-motion (content stays).
export function GradeReveal({ grade, score, orphanCount, avgDepth, confidenceBand }: Props) {
  const passing = score >= 60;
  const isEstimate = confidenceBand?.isEstimate ?? false;
  return (
    <div className="animate-grade-pop motion-reduce:animate-none">
      <p className="sr-only" role="status" aria-live="polite">
        {isEstimate && confidenceBand
          ? `Estimated grade ${grade}, about ${score} out of 100, ${estimateBasisText(confidenceBand)}.`
          : `Your grade is ${grade}, ${score} out of 100.`}
      </p>

      {isEstimate && confidenceBand && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge tone="warning">Estimate</Badge>
          <span className="text-caption text-ink-muted">
            ~{grade}/{score} · {estimateBasisText(confidenceBand)} · {confidenceBand.confidence} confidence
          </span>
        </div>
      )}

      <GradeCard grade={grade} score={score} orphanCount={orphanCount} avgDepth={avgDepth ?? 0} passing={passing} />

      {isEstimate && confidenceBand && (
        <Explainer className="mt-2" summary="Why is this an estimate?">
          <p>
            We crawled {estimateBasisText(confidenceBand)} — a partial view — so we show a range (
            {confidenceBand.lower}–{confidenceBand.upper}) rather than a single hard grade. Crawl your
            whole site for a confident grade.
          </p>
        </Explainer>
      )}

      <Explainer className="mt-2" summary="What does this grade measure?">
        <p>
          Your <strong>internal linking</strong> — how your pages link to one another. We weigh four
          things: orphan pages (40%), how deep pages sit from the homepage (20%), how descriptive your
          link text is (20%), and how well your structure concentrates importance (20%).
        </p>
      </Explainer>
    </div>
  );
}
