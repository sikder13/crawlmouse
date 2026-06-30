import type { ConfidenceBand } from '@crawlmouse/types';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { Explainer } from '../ui/Explainer';
import { ShareSurface } from '../share/ShareSurface';
import { GradeGauge } from './GradeGauge';
import { estimateBasisText, gaugeTier } from './result-logic';

interface Props {
  grade: string;
  score: number;
  orphanCount: number;
  avgDepth: number | null;
  confidenceBand?: ConfidenceBand | null;
  achievableGrade?: string; // the projected grade — shown adjacent so a C reads as "C → B+"
  shareUrl?: string;
}

// The grade reveal — the wow (§3, D0): the dramatized gauge + tier framing (trophy for high, a
// supportive "this is fixable" for low) + an impulse-capture share at the emotional peak (D1) + the
// estimate form (§8) + a live-region announce (§9) + the plain-language "what your grade measures".
export function GradeReveal({ grade, score, orphanCount, avgDepth, confidenceBand, achievableGrade, shareUrl }: Props) {
  const meta = gaugeTier(grade);
  const isEstimate = confidenceBand?.isEstimate ?? false;
  return (
    <Card variant="raised" className="animate-reveal-up motion-reduce:animate-none">
      <p className="sr-only" role="status" aria-live="polite">
        {isEstimate && confidenceBand
          ? `Estimated grade ${grade}, about ${Math.round(score)} out of 100, ${estimateBasisText(confidenceBand)}.`
          : `Your grade is ${grade}, ${Math.round(score)} out of 100.`}
      </p>

      <div className="flex flex-col items-center gap-5 sm:flex-row sm:gap-6">
        <GradeGauge grade={grade} score={score} />
        <div className="min-w-0 text-center sm:text-left">
          {isEstimate && confidenceBand && (
            <div className="mb-2 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <Badge tone="warning">Estimate</Badge>
              <span className="text-caption text-ink-muted">
                {estimateBasisText(confidenceBand)} · {confidenceBand.confidence} confidence
              </span>
            </div>
          )}
          <h2 className="font-display text-h2 leading-tight">{meta.headline}</h2>
          {achievableGrade && meta.tier !== 'strong' && achievableGrade !== grade && (
            <p className="mt-1 font-display text-h3 leading-tight">
              {grade} <span aria-hidden="true">→</span>{' '}
              <span className="text-accent-text">{achievableGrade}</span>{' '}
              <span className="font-sans text-caption font-normal text-ink-muted">achievable</span>
            </p>
          )}
          <p className="mt-1 text-body text-ink-muted">{meta.sub}</p>
          <p className="mt-2 text-caption text-ink-muted">
            {orphanCount} orphan {orphanCount === 1 ? 'page' : 'pages'}
            {avgDepth != null ? ` · ${avgDepth.toFixed(1)} avg click depth` : ''}
          </p>
        </div>
      </div>

      {/* D1 — impulse-capture share at the emotional peak. */}
      <div className="mt-5 border-t border-oat pt-4">
        <ShareSurface grade={grade} score={score} shareUrl={shareUrl} compact />
      </div>

      {isEstimate && confidenceBand && (
        <Explainer className="mt-3" summary="Why is this an estimate?">
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
    </Card>
  );
}
