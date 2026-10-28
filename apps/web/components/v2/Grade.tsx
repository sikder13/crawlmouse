import type { ReactNode } from 'react';
import { VisuallyHidden } from './VisuallyHidden';
import styles from './Grade.module.css';

export interface GradeProps {
  /** What is graded, e.g. "Technical SEO". */
  label: string;
  /** A–F with an optional + or -. Absent when withheld. */
  letter?: string;
  /** 0 to max. Absent when withheld. */
  score?: number;
  max?: number;
  /** The caller decides the tone from the data; the component does not map letters to colours. */
  tone?: 'default' | 'bad';
  size?: 'md' | 'lg';
  /** The evidence cannot support a letter, so none is shown. */
  withheld?: boolean;
  /** One or two sentences under the grade. */
  children?: ReactNode;
}

const LETTER = /^[A-F][+-]?$/;

/** A letter grade and its score out of 100, or a withheld grade that shows neither. */
export function Grade({
  label,
  letter,
  score,
  max = 100,
  tone = 'default',
  size = 'md',
  withheld = false,
  children,
}: GradeProps) {
  if (withheld) {
    if (letter !== undefined || score !== undefined) {
      throw new Error(`Grade "${label}": a withheld grade carries no letter and no score`);
    }
  } else {
    if (!letter || !LETTER.test(letter)) {
      throw new Error(
        `Grade "${label}": letter must be A–F with an optional + or -, got ${letter}`,
      );
    }
    if (score === undefined || !Number.isFinite(score) || score < 0 || score > max) {
      throw new Error(`Grade "${label}": score must be between 0 and ${max}, got ${score}`);
    }
  }

  return (
    <div
      className={styles[size]}
      data-v2-grade=""
      data-v2-grade-tone={tone}
      {...(withheld ? { 'data-v2-grade-withheld': '' } : {})}
    >
      <div className={styles.label}>{label}</div>
      <div className={styles.row}>
        {withheld ? (
          <>
            <span className={`${styles.letter} ${styles.withheldMark}`} aria-hidden="true">
              –
            </span>
            <VisuallyHidden>Grade </VisuallyHidden>
            <span className={styles.score}>withheld</span>
          </>
        ) : (
          <>
            <span
              className={`${styles.letter} ${tone === 'bad' ? styles.bad : ''}`}
              data-v2-grade-letter={letter}
            >
              {letter}
            </span>
            <span className={styles.score}>
              {score} / {max}
            </span>
          </>
        )}
      </div>
      {children ? <p className={styles.desc}>{children}</p> : null}
    </div>
  );
}
