import type { ReactNode } from 'react';
import { Button } from '../../Button';
import type { SegmentFrame } from '../../../../lib/v2/view/segment/frame';
import { ResultShell } from '../result/ResultScreen';
import { KeepBar, type InlineKeep } from '../result/KeepBar';
import { SegmentTabs } from './SegmentTabs';
import layout from '../../layout.module.css';
import styles from './SegmentScreen.module.css';

/**
 * A segment page's frame: the result page's header, the crumb and section tabs, the page's
 * content, the keep bar in the flow after it, and the back and next links. The next link is the
 * page's orange element when the page has no free fix to copy (FACTS orange convention).
 */
export function SegmentShell({
  frame,
  keep,
  nextPrimary,
  children,
}: {
  frame: SegmentFrame;
  keep: InlineKeep | null;
  nextPrimary: boolean;
  children: ReactNode;
}) {
  const last = frame.key === 'changes';
  return (
    <ResultShell share={{ keptUntil: frame.keptUntil }} rerun mainClassName={styles.main}>
      <div className={`${layout.row} ${styles.crumbRow}`}>
        <div className={`${layout.row} ${styles.crumb}`}>
          <a href={frame.tabs[0]!.href}>{frame.domain}</a>
          <span className={layout.mut}>/</span>
          <span>{frame.title}</span>
          {frame.keptUntil ? (
            <span className={layout.mut}>· kept until {frame.keptUntil}</span>
          ) : null}
        </div>
        <SegmentTabs tabs={frame.tabs} />
      </div>
      {children}
      {keep && frame.keptUntil ? (
        <KeepBar domain={frame.domain} expires={frame.keptUntil} inline={keep} />
      ) : null}
      <div className={`${layout.row} ${styles.nav}`}>
        <Button variant="quiet" href={frame.back.href}>
          {frame.back.label}
        </Button>
        <Button
          variant={last ? 'quiet' : nextPrimary ? 'primary' : 'default'}
          href={frame.next.href}
        >
          {frame.next.label}
        </Button>
      </div>
    </ResultShell>
  );
}
