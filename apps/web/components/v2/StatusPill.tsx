import type { ReactNode } from 'react';
import { VisuallyHidden } from './VisuallyHidden';
import styles from './StatusPill.module.css';

/**
 * Rule 7: status is colour plus shape. Four states carry a glyph; `neutral` is for counts and
 * scores that are not a status, and carries none.
 */
export type PillState = 'ok' | 'warn' | 'bad' | 'unverified' | 'neutral';

/** The glyph each state draws, and the word a screen reader hears before the label. */
export const PILL_STATES: Record<PillState, { glyph: string | null; spoken: string | null }> = {
  ok: { glyph: '●', spoken: 'OK' },
  warn: { glyph: '▲', spoken: 'Warning' },
  bad: { glyph: '■', spoken: 'Problem' },
  unverified: { glyph: '○', spoken: 'Unverified' },
  neutral: { glyph: null, spoken: null },
};

export interface StatusPillProps {
  state: PillState;
  children: ReactNode;
}

/** A tinted pill: a status glyph and a short label (rule 7). */
export function StatusPill({ state, children }: StatusPillProps) {
  const { spoken } = PILL_STATES[state];
  return (
    <span className={`${styles.pill} ${styles[state]}`} data-v2-pill={state}>
      <Glyph state={state} />
      {spoken ? <VisuallyHidden>{`${spoken}: `}</VisuallyHidden> : null}
      {children}
    </span>
  );
}

/** The four status shapes, drawn so they render the same in every font and on every machine. */
export function Glyph({ state, className }: { state: PillState; className?: string }) {
  if (state === 'neutral') return null;
  const shape =
    state === 'ok' ? (
      <circle cx="5" cy="5" r="4.5" fill="currentColor" />
    ) : state === 'warn' ? (
      <polygon points="5,0.5 9.8,9.5 0.2,9.5" fill="currentColor" />
    ) : state === 'bad' ? (
      <rect x="0.5" y="0.5" width="9" height="9" fill="currentColor" />
    ) : (
      <circle cx="5" cy="5" r="3.9" fill="none" stroke="currentColor" strokeWidth="1.4" />
    );
  return (
    <svg
      className={className ?? styles.glyph}
      viewBox="0 0 10 10"
      aria-hidden="true"
      focusable="false"
      data-v2-glyph={state}
    >
      {shape}
    </svg>
  );
}
