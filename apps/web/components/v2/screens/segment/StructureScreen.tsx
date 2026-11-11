import { Button } from '../../Button';
import { Card } from '../../Card';
import { Heading } from '../../Heading';
import { ScrollRegion } from '../../ScrollRegion';
import { Table } from '../../Table';
import { MapSvg } from '../../map/MapSvg';
import { hasPacketToCopy } from '../../../../lib/v2/view/no-packet';
import type { StructureMapView, StructureView } from '../../../../lib/v2/view/segment/structure';
import { SectionFixes, VerdictCard } from './SegmentParts';
import { SegmentShell } from './SegmentShell';
import layout from '../../layout.module.css';
import styles from './SegmentScreen.module.css';
import own from './StructureScreen.module.css';

/** The crawl's link map, static here, with its legend in a band under it. */
function LinkMap({ map }: { map: StructureMapView }) {
  return (
    <Card as="section" className={own.stage}>
      <ScrollRegion label="Link map" className={own.mapScroll}>
        <div className={own.canvas}>
          <MapSvg nodes={map.nodes} positions={map.positions} label={map.label} />
        </div>
      </ScrollRegion>
      <div className={`${layout.row} ${own.legend}`}>
        <span className={layout.row}>
          <span className={own.keyDot} />
          page
        </span>
        {map.legend.jsOnly ? (
          <span className={layout.row}>
            <span className={own.keyTriangle} />
            JavaScript-only · {map.legend.jsOnly}
          </span>
        ) : null}
        {map.legend.orphans ? (
          <span className={layout.row}>
            <span className={own.keySquare} />
            orphan · {map.legend.orphans}
          </span>
        ) : null}
        {map.legend.jsLinks ? (
          <span className={layout.row}>
            <span className={own.keyDash} />
            JavaScript-only link
          </span>
        ) : null}
        <span className={layout.mut}>{map.caption}</span>
        <Button variant="quiet" size="sm" href={map.exploreHref} className={own.explore}>
          {map.explore}
        </Button>
      </div>
    </Card>
  );
}

/**
 * Site structure (Final-Seg-Structure): the orphan count and the link graph's figures, the crawl's
 * map, the orphan pages with where each belongs, then the section's fixes and the keep bar.
 */
export function StructureScreen({ data }: { data: StructureView }) {
  const { frame, headline, orphans } = data;
  return (
    <SegmentShell frame={frame} keep={data.keep} nextPrimary={!hasPacketToCopy(data.fixes)}>
      <VerdictCard
        title={headline.title}
        pill={headline.pill}
        body={headline.body}
        tiles={data.tiles}
        coverage={{ pages: data.coverage }}
      />
      {data.map ? <LinkMap map={data.map} /> : null}
      <Card as="section" className={styles.panel}>
        <div className={`${layout.row} ${styles.hd}`}>
          <div>
            <Heading level={2} size="s">
              {orphans.heading}
            </Heading>
            {orphans.sub ? <div className={styles.sub}>{orphans.sub}</div> : null}
          </div>
          {orphans.rows.length ? (
            <div className={`${layout.row} ${styles.hdActions}`}>
              <Button variant="quiet" size="sm" href={orphans.explorerHref}>
                Open in the explorer
              </Button>
              <Button variant="quiet" size="sm" href={frame.keepHref}>
                Export CSV with Pro
              </Button>
            </div>
          ) : null}
        </div>
        {orphans.rows.length ? (
          <Table
            label="Orphan pages"
            columns={[
              { header: 'Page', mono: true },
              { header: 'Links in', numeric: true, mono: true },
              { header: 'Found via' },
              { header: 'Suggested parent', mono: true },
              { header: 'Crawlers that read its text', numeric: true, mono: true },
              { header: 'Last changed', numeric: true, mono: true, muted: true },
            ]}
            rows={orphans.rows.map((r) => ({
              key: r.page,
              cells: [r.page, r.linksIn, r.foundVia, r.parent, r.reading, r.lastChanged],
            }))}
          />
        ) : null}
        {orphans.unlisted ? <p className={styles.footnote}>{orphans.unlisted}</p> : null}
        {orphans.notes.map((n) => (
          <p key={n} className={styles.footnote}>
            {n}
          </p>
        ))}
      </Card>
      <SectionFixes
        id="fixes"
        heading="Fixes for site structure"
        fixes={data.fixes}
        ask={frame.keepHref}
      />
    </SegmentShell>
  );
}
