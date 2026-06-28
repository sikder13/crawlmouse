import { sparklinePoints } from './dashboard-logic';

const W = 120;
const H = 28;

// Grade-over-time sparkline (the monitoring payoff). Color comes from the caller via currentColor
// (sage rising / warning falling) — a graphical line, so the tier color clears the 3:1 non-text bar.
export function Sparkline({ scores, className = '' }: { scores: number[]; className?: string }) {
  const points = sparklinePoints(scores, W, H);
  if (!points) return null;
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      role="img"
      aria-label="Grade over time"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
