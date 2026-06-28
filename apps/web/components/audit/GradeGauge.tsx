'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { gaugeDashoffset, gaugeTier } from './result-logic';

// useLayoutEffect on the client (no count-up flash), useEffect on the server (no SSR warning).
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

// `lg` = the result-page hero gauge; `sm` = the compact, glanceable gauge reused on dashboard cards
// (and, later, the OG card + badge) so the gauge is the ONE persistent object across every surface.
const DIMS = {
  lg: { r: 64, stroke: 12, letter: 'text-h1', showNum: true },
  sm: { r: 26, stroke: 6, letter: 'text-h3', showNum: false },
} as const;

export function GradeGauge({
  grade,
  score,
  size = 'lg',
}: {
  grade: string;
  score: number;
  size?: 'lg' | 'sm';
}) {
  const meta = gaugeTier(grade);
  const dim = DIMS[size];
  const R = dim.r;
  const STROKE = dim.stroke;
  const CIRC = 2 * Math.PI * R;
  const SIZE = (R + STROKE) * 2;
  const target = Math.max(0, Math.min(100, Math.round(score)));
  const [value, setValue] = useState(target);
  const rafRef = useRef<number | null>(null);

  useIsoLayoutEffect(() => {
    const reduce =
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (reduce) {
      setValue(target);
      return;
    }
    setValue(0);
    const start = performance.now();
    const DUR = 1200;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DUR);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setValue(target * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [target]);

  const shown = Math.round(value);
  const offset = gaugeDashoffset(value, CIRC);

  return (
    <div
      role="img"
      aria-label={`Grade ${grade}, ${target} out of 100`}
      className="relative inline-flex items-center justify-center"
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" strokeWidth={STROKE} stroke="currentColor" className="text-oat" />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          stroke="currentColor"
          strokeDasharray={CIRC}
          strokeDashoffset={offset}
          className={`${meta.arcClass} transition-[stroke-dashoffset] motion-reduce:transition-none`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center" aria-hidden="true">
        <span className={`font-display ${dim.letter} leading-none text-ink`}>{grade}</span>
        {dim.showNum && (
          <span className="mt-1 font-mono text-caption font-semibold text-ink-muted">
            <span className={meta.arcClass}>{meta.icon}</span> {shown}/100
          </span>
        )}
      </div>
    </div>
  );
}
