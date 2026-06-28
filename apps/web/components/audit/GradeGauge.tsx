'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { gaugeDashoffset, gaugeTier } from './result-logic';

// useLayoutEffect on the client (no count-up flash), useEffect on the server (no SSR warning).
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const R = 64;
const STROKE = 12;
const CIRC = 2 * Math.PI * R;
const SIZE = (R + STROKE) * 2;

// The dramatized grade gauge (D0): an animated radial arc that counts up 0→score and settles in the
// grade tier's color (sage / peach / warning), with the serif letter + number + a tier icon in the
// center. Default/SSR/reduced-motion render at the final value (accessible, no-JS-safe); when motion
// is allowed it animates the count-up. Never color-only — letter + number + icon carry the meaning.
export function GradeGauge({ grade, score }: { grade: string; score: number }) {
  const meta = gaugeTier(grade);
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
        <span className="font-display text-h1 leading-none text-ink">{grade}</span>
        <span className="mt-1 font-mono text-caption font-semibold text-ink-muted">
          <span className={meta.arcClass}>{meta.icon}</span> {shown}/100
        </span>
      </div>
    </div>
  );
}
