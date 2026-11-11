import { Button } from '../../Button';
import { Card } from '../../Card';
import { Heading } from '../../Heading';
import { hasPacketToCopy } from '../../../../lib/v2/view/no-packet';
import type { AccessView } from '../../../../lib/v2/view/segment/access';
import { AccessMatrix } from './AccessMatrix';
import { SectionFixes, VerdictCard } from './SegmentParts';
import { SegmentShell } from './SegmentShell';
import layout from '../../layout.module.css';
import styles from './SegmentScreen.module.css';

/**
 * Crawler access (Final-Segment): the verdict, then what each crawler got back by section with the
 * raw evidence behind each cell, then the section's fixes and the keep bar.
 */
export function AccessScreen({ data }: { data: AccessView }) {
  const { frame, headline } = data;
  return (
    <SegmentShell frame={frame} keep={data.keep} nextPrimary={!hasPacketToCopy(data.fixes)}>
      <VerdictCard
        title={headline.title}
        pill={headline.pill}
        body={headline.body}
        tiles={data.tiles}
        coverage={{ pages: data.coverage }}
      />
      <Card as="section" className={styles.panel}>
        <div className={`${layout.row} ${styles.hd}`}>
          <div>
            <Heading level={2} size="s">
              What each crawler got back, by section of the site
            </Heading>
            <div className={styles.sub}>{data.method}</div>
          </div>
          <div className={`${layout.row} ${styles.hdActions}`}>
            <Button variant="quiet" size="sm" href="#evidence">
              Raw responses
            </Button>
            <Button variant="quiet" size="sm" href={frame.keepHref}>
              Export CSV with Pro
            </Button>
          </div>
        </div>
        <AccessMatrix
          columns={data.columns}
          groups={data.groups}
          evidence={data.evidence}
          initial={data.initial}
          noEvidence={data.noEvidence}
          cellWithoutEvidence={data.cellWithoutEvidence}
          footnote={data.footnote}
        />
      </Card>
      <SectionFixes heading="Fixes for crawler access" fixes={data.fixes} ask={frame.keepHref} />
    </SegmentShell>
  );
}
