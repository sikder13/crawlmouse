import { Button } from '../../Button';
import { Card } from '../../Card';
import { Heading } from '../../Heading';
import { hasPacketToCopy } from '../../../../lib/v2/view/no-packet';
import type { ContentView } from '../../../../lib/v2/view/segment/content';
import { ContentGrid } from './ContentGrid';
import { SectionFixes, VerdictCard } from './SegmentParts';
import { SegmentShell } from './SegmentShell';
import layout from '../../layout.module.css';
import styles from './SegmentScreen.module.css';

/**
 * Content an answer engine can quote (Final-Seg-Content): the verdict, the five checks by
 * section with the failing pages behind each, then the section's fixes. With no free fix here,
 * the next link is the page's orange element.
 */
export function ContentScreen({ data }: { data: ContentView }) {
  const { frame, headline } = data;
  return (
    <SegmentShell frame={frame} keep={data.keep} nextPrimary={!hasPacketToCopy(data.fixes)}>
      <VerdictCard
        title={headline.title}
        pill={headline.pill}
        body={headline.body}
        tiles={data.tiles}
        coverage={data.coverage}
      />
      {data.grid ? (
        <Card as="section" className={styles.panel}>
          <div className={`${layout.row} ${styles.hd}`}>
            <div>
              <Heading level={2} size="s">
                {data.grid.title}
              </Heading>
              <div className={styles.sub}>
                Share of pages in each section that pass: ● 80% or more, ▲ some, ■ under 5%. Select
                a cell for the pages that fail it.
              </div>
            </div>
            <div className={`${layout.row} ${styles.hdActions}`}>
              <Button variant="quiet" size="sm" href={frame.keepHref}>
                Export CSV with Pro
              </Button>
            </div>
          </div>
          <ContentGrid grid={data.grid} initial={data.initial} noFailing={data.noFailing} />
        </Card>
      ) : null}
      <SectionFixes
        heading="Fixes for quotable content"
        fixes={data.fixes}
        note={data.fixesNote}
        ask={frame.keepHref}
      />
    </SegmentShell>
  );
}
