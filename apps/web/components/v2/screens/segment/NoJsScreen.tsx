import { Button } from '../../Button';
import { Card } from '../../Card';
import { Heading } from '../../Heading';
import type { NoJsView } from '../../../../lib/v2/view/segment/nojs';
import { NoJsTable } from './NoJsTable';
import { SectionFixes, VerdictCard } from './SegmentParts';
import { SegmentShell } from './SegmentShell';
import layout from '../../layout.module.css';
import styles from './SegmentScreen.module.css';
import own from './NoJsScreen.module.css';

/**
 * Readable without JavaScript (Final-Seg-JS): the verdict, then how much of each measured page
 * survives without scripts, with the two responses behind the selected page, then the fixes.
 */
export function NoJsScreen({ data }: { data: NoJsView }) {
  const { frame, headline } = data;
  return (
    <SegmentShell frame={frame} keep={data.keep} nextPrimary={data.fixes.open.length === 0}>
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
              How much of each page survives without JavaScript
            </Heading>
            <div className={styles.sub}>
              Words in the raw HTML as a share of words a browser renders, excluding script tags.{' '}
              {data.measuredSet} Select a row to compare the two.
            </div>
            {data.recordLine ? (
              <p className={own.recordLine} data-v2-addition="">
                {data.recordLine}
              </p>
            ) : null}
          </div>
          <div className={`${layout.row} ${styles.hdActions}`}>
            <Button variant="quiet" size="sm" href={frame.keepHref}>
              {data.proLabel}
            </Button>
          </div>
        </div>
        {/* With no measured page in the record there is nothing to tabulate; the line above says so. */}
        {data.rows.length ? (
          <NoJsTable rows={data.rows} initial={data.initial} missing={data.missing} />
        ) : null}
      </Card>
      <SectionFixes
        heading="Fixes for text without JavaScript"
        fixes={data.fixes}
        footnote={data.fixesNote}
        ask={frame.keepHref}
      />
    </SegmentShell>
  );
}
