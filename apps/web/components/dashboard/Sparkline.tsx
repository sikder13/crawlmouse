import { sparklineSegments } from './dashboard-logic';

const W = 120;
const H = 28;

// Grade-over-time sparkline (the monitoring payoff). Color comes from the caller via currentColor
// (sage rising / warning falling) — a graphical line, so the tier color clears the 3:1 non-text bar.
//
// A score may be null since SPEC 5.1a Stage 4 (the refusal gate withheld a verdict). The line BREAKS
// there rather than dropping to the floor: a null plotted as 0 would draw a cliff the site never fell
// off, and this is the monitoring surface, where a fabricated decline is the most alarming lie we
// could tell an owner.
export function Sparkline({ scores, className = '' }: { scores: (number | null)[]; className?: string }) {
  const segments = sparklineSegments(scores, W, H);
  if (segments.length === 0) return null;
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      role="img"
      aria-label="Grade over time"
    >
      {segments.map((points) => (
        <polyline
          key={points}
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
