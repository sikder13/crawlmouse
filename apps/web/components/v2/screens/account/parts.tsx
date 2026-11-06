import type { ReactNode } from 'react';
import { Heading } from '../../Heading';
import type { GradeCell } from '../../../../lib/v2/view/checks';
import styles from './AccountScreen.module.css';

/** "B 79" in a table cell: the letter, in the bad tone for D and F, and the score in the data face. */
export function GradeText({
  grade,
  withheld = false,
}: {
  grade: GradeCell | null;
  withheld?: boolean;
}) {
  if (!grade) return <span className={styles.muted}>{withheld ? 'withheld' : '—'}</span>;
  return (
    <>
      <span className={grade.tone === 'bad' ? styles.bad : undefined}>{grade.letter}</span>{' '}
      <span className={styles.score}>{grade.score}</span>
    </>
  );
}

/** A card's head row: its heading (a problem the reader has, rule 11), a line under it, and actions. */
export function CardHead({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string | null;
  children?: ReactNode;
}) {
  return (
    <div className={styles.head}>
      <div>
        <Heading level={2} size="s" className={styles.h2}>
          {title}
        </Heading>
        {sub ? <div className={styles.sub}>{sub}</div> : null}
      </div>
      {children ? <div className={styles.headActions}>{children}</div> : null}
    </div>
  );
}
