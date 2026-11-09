import { Glyph } from './StatusPill';
import { VisuallyHidden } from './VisuallyHidden';
import type { PillState } from './pill-states';
import type { Verdict } from './verdicts';
import styles from './CheckGlyphRow.module.css';

export interface CheckGlyphCell {
  state: PillState;
  /** The verdict in words, read where the glyph is drawn: "blocked by robots.txt". */
  label: string;
  /** The verdict behind it, so a test can hold the words to the verdict. */
  verdict: Verdict | null;
}

/** One check's verdict as a tinted glyph with its words for a screen reader (rule 7). */
export function CheckGlyph({ cell }: { cell: CheckGlyphCell }) {
  return (
    <span
      className={`${styles.cell} ${styles[cell.state]}`}
      data-v2-check-glyph={cell.state}
      {...(cell.verdict ? { 'data-v2-verdict': cell.verdict } : {})}
    >
      <Glyph state={cell.state} className={styles.glyph} />
      <VisuallyHidden>{cell.label}</VisuallyHidden>
    </span>
  );
}

/**
 * A crawler's verdicts across checks, one glyph per check, ● ▲ ■ ○ in each state's colour. The
 * glyphs are drawn and hidden; `spoken` says the same in words, in order.
 */
export function CheckGlyphRow({
  cells,
  spoken,
}: {
  cells: readonly CheckGlyphCell[];
  spoken: string;
}) {
  const verdicts = [...new Set(cells.flatMap((c) => (c.verdict ? [c.verdict] : [])))];
  return (
    <span className={styles.row} data-v2-verdicts={verdicts.join(' ')}>
      <span className={styles.glyphs} aria-hidden="true">
        {cells.map((c, i) => (
          <Glyph key={i} state={c.state} className={`${styles.glyph} ${styles[`${c.state}Ink`]}`} />
        ))}
      </span>
      <VisuallyHidden>{spoken}</VisuallyHidden>
    </span>
  );
}
