/**
 * Rule 7: status is colour plus shape. Four states carry a glyph; `neutral` is for counts and
 * scores that are not a status, and carries none.
 */
export type PillState = 'ok' | 'warn' | 'bad' | 'unverified' | 'neutral';

/** The four status glyphs of rule 7. */
export type GlyphChar = '●' | '▲' | '■' | '○';

/**
 * The glyph each state shows, and the word a screen reader hears before the label. StatusPill
 * draws the shape this character names, so the table decides what is drawn.
 */
export const PILL_STATES: Record<PillState, { glyph: GlyphChar | null; spoken: string | null }> = {
  ok: { glyph: '●', spoken: 'OK' },
  warn: { glyph: '▲', spoken: 'Warning' },
  bad: { glyph: '■', spoken: 'Problem' },
  unverified: { glyph: '○', spoken: 'Unverified' },
  neutral: { glyph: null, spoken: null },
};
