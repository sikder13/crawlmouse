import type { ReactElement, ReactNode } from 'react';
import { VisuallyHidden } from './VisuallyHidden';
import styles from './StatusPill.module.css';

import { PILL_STATES, type GlyphChar, type PillState } from './pill-states';

export { PILL_STATES, type GlyphChar, type PillState };

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

/**
 * The shape for each glyph character, drawn so it renders the same in every font and on every
 * machine (a typed ● falls back to whatever system font has it).
 */
export function glyphShape(glyph: GlyphChar): ReactElement {
  switch (glyph) {
    case '●':
      return <circle cx="5" cy="5" r="4.5" fill="currentColor" />;
    case '▲':
      return <polygon points="5,0.5 9.8,9.5 0.2,9.5" fill="currentColor" />;
    case '■':
      return <rect x="0.5" y="0.5" width="9" height="9" fill="currentColor" />;
    case '○':
      return <circle cx="5" cy="5" r="3.9" fill="none" stroke="currentColor" strokeWidth="1.4" />;
  }
}

/** The status shape for a state, looked up through its glyph character in PILL_STATES. */
export function Glyph({ state, className }: { state: PillState; className?: string }) {
  const glyph = PILL_STATES[state].glyph;
  if (!glyph) return null;
  return (
    <svg
      className={className ?? styles.glyph}
      viewBox="0 0 10 10"
      aria-hidden="true"
      focusable="false"
      data-v2-glyph={state}
      data-v2-glyph-char={glyph}
    >
      {glyphShape(glyph)}
    </svg>
  );
}
