import type { ReactNode } from 'react';
import styles from './TrialCard.module.css';

export interface TrialCardProps {
  /** "Pro, trial · ends Sat 7 Nov". */
  title: string;
  /** "8 days left". */
  left: string;
  /** What happens when the trial ends. Hidden on a phone, where the card is one line. */
  note: string;
  /** Beside the days left: the billing link on the first run. */
  aside?: ReactNode;
  /** Under the note: keeping the plan. */
  children?: ReactNode;
}

/**
 * The rail's trial banner: when the trial ends, how long is left, and what Free keeps. On a phone
 * it is a single strip with the action still in reach (DESIGN-LOCK §6, phone rules).
 */
export function TrialCard({ title, left, note, aside, children }: TrialCardProps) {
  return (
    <div className={styles.card} data-v2-trial-card="">
      <div className={styles.title}>{title}</div>
      <div className={styles.left}>
        {left}
        {aside ? (
          <>
            {' '}
            <span className={styles.aside}>{aside}</span>
          </>
        ) : null}
      </div>
      <div className={styles.note} data-v2-phone-secondary="">
        {note}
      </div>
      {children ? <div className={styles.actions}>{children}</div> : null}
    </div>
  );
}
