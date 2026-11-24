import type { ReactNode } from 'react';
import { Card } from '../../Card';
import { Heading } from '../../Heading';
import { StatusPill } from '../../StatusPill';
import { Table } from '../../Table';
import type { BasicsColumnView, LinksView, ShortList } from '../../../../lib/v2/view/segment/links';
import { VerdictCard } from './SegmentParts';
import { SegmentShell } from './SegmentShell';
import layout from '../../layout.module.css';
import styles from './SegmentScreen.module.css';
import own from './LinksScreen.module.css';

/** A list of at most ten, then "and N more" opening the rest. */
function Short<T>({
  list,
  item,
  keyOf,
}: {
  list: ShortList<T>;
  item: (x: T) => ReactNode;
  keyOf: (x: T, i: number) => string;
}) {
  return (
    <>
      <ul className={own.list}>
        {list.shown.map((x, i) => (
          <li key={keyOf(x, i)} className={own.breakAnywhere}>
            {item(x)}
          </li>
        ))}
      </ul>
      {list.more ? (
        <details className={own.more}>
          <summary>{list.more}</summary>
          <ul className={own.list}>
            {list.rest.map((x, i) => (
              <li key={keyOf(x, i + list.shown.length)} className={own.breakAnywhere}>
                {item(x)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}

const path = (p: string) => <span className={own.mono}>{p}</span>;

function Basics({ col }: { col: BasicsColumnView }) {
  return (
    <Card as="section" className={`${styles.panel} ${own.column}`}>
      <Heading level={2} size="s">
        {col.heading}
      </Heading>
      <div className={own.line}>{col.missingLine}</div>
      {col.missing.shown.length ? <Short list={col.missing} item={path} keyOf={(p) => p} /> : null}
      <div className={own.line}>{col.sharedLine}</div>
      {col.shared.shown.length ? (
        <Short
          list={col.shared}
          keyOf={(g) => g.text}
          item={(g) => (
            <div className={own.group}>
              {g.line}
              <Short list={g.pages} item={path} keyOf={(p) => p} />
            </div>
          )}
        />
      ) : null}
    </Card>
  );
}

/**
 * Links and pages (row 5): pages that answer an error and where they are linked from, redirects,
 * and the titles and meta descriptions that are missing or shared. Headings are not read yet, and
 * the page says so.
 */
export function LinksScreen({ data }: { data: LinksView }) {
  const { frame } = data;
  return (
    <SegmentShell frame={frame} keep={data.keep} nextPrimary>
      <VerdictCard
        title={data.headline.title}
        pill={data.headline.pill}
        body={data.body}
        tiles={data.tiles}
        coverage={data.coverage}
      />
      <Card as="section" className={styles.panel}>
        <div className={`${layout.row} ${styles.hd}`}>
          <Heading level={2} size="s">
            Broken links
          </Heading>
        </div>
        {data.broken.empty ? (
          <p className={own.empty}>{data.broken.empty}</p>
        ) : (
          <Table
            label="Broken links"
            columns={[
              { header: 'Missing page' },
              { header: 'Status', numeric: true, mono: true },
              { header: 'Linked from' },
            ]}
            rows={data.broken.rows.map((r) => ({
              key: r.path,
              cells: [
                <span key="p" className={`${own.mono} ${own.breakAnywhere}`}>
                  {r.path}
                </span>,
                <StatusPill key="s" state="bad">
                  {String(r.status)}
                </StatusPill>,
                <div key="f" className={own.breakAnywhere}>
                  {r.linkedSummary}
                  {r.linkedFrom.length ? (
                    <details className={own.more}>
                      <summary>Every page that links to it</summary>
                      <ul className={own.list}>
                        {r.linkedFrom.map((l, i) => (
                          <li key={`${l.path}-${i}`} className={own.breakAnywhere}>
                            {path(l.path)}{' '}
                            <span className={own.anchor}>&ldquo;{l.anchor}&rdquo;</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>,
              ],
            }))}
          />
        )}
      </Card>
      <Card as="section" className={styles.panel}>
        <div className={`${layout.row} ${styles.hd}`}>
          <Heading level={2} size="s">
            Redirects
          </Heading>
        </div>
        {data.redirects.empty ? (
          <p className={own.empty}>{data.redirects.empty}</p>
        ) : (
          <Table
            label="Redirects"
            columns={[{ header: 'Linked as' }, { header: 'Hops' }, { header: 'Ends at' }]}
            rows={data.redirects.rows.map((r) => ({
              key: r.path,
              cells: [
                <span key="p" className={`${own.mono} ${own.breakAnywhere}`}>
                  {r.path}
                </span>,
                <span key="h" className={`${own.mono} ${own.breakAnywhere}`}>
                  {r.hops}
                </span>,
                r.loop ? (
                  <StatusPill key="e" state="bad">
                    {r.endsText}
                  </StatusPill>
                ) : (
                  <span key="e" className={`${own.mono} ${own.breakAnywhere}`}>
                    {r.endsText}
                  </span>
                ),
              ],
            }))}
          />
        )}
      </Card>
      <div className={own.basics}>
        <Basics col={data.titles} />
        <Basics col={data.descriptions} />
      </div>
      <p className={own.headings}>{data.headings}</p>
    </SegmentShell>
  );
}
