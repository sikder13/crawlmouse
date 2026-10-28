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
