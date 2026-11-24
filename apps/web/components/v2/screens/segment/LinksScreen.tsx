import type { ReactNode } from 'react';
import { Card } from '../../Card';
import { Heading } from '../../Heading';
import { StatusPill } from '../../StatusPill';
import { Table } from '../../Table';
import {
  NO_LINK_TEXT,
  REQUESTED_AS,
  type BasicsColumnView,
  type ErrorRowView,
  type LinksView,
  type PageRef,
  type ShortList,
} from '../../../../lib/v2/view/segment/links';
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

const path = (p: PageRef) => <span className={own.mono}>{p.path}</span>;
const byUrl = (p: PageRef) => p.url;

/** The page's URL, and the URLs of the record that redirect to it. */
function PageCell({ r }: { r: ErrorRowView }) {
  return (
    <span className={`${own.mono} ${own.breakAnywhere}`}>
      {r.path}
      {r.via.length ? (
        <span className={own.anchor}> (redirected from {r.via.join(', ')})</span>
      ) : null}
    </span>
  );
}

/** "/a, /b and 1 more", then the links in the record that lead to the page, each with its text. */
function LinkedFrom({ r }: { r: ErrorRowView }) {
  return (
    <div className={own.breakAnywhere}>
      {r.linkedSummary}
      {r.linkedFrom.length ? (
        <details className={own.more}>
          <summary>Linked from</summary>
          <ul className={own.list}>
            {r.linkedFrom.map((l, i) => (
              <li key={`${l.url}-${i}`} className={own.breakAnywhere}>
                {path(l)}{' '}
                <span className={own.anchor}>
                  {l.anchor === null ? NO_LINK_TEXT : <>&ldquo;{l.anchor}&rdquo;</>}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** A table of pages that answered an error: the page, its status, and the links that lead to it. */
function ErrorTable({
  label,
  pageHeader,
  tone,
  rows,
}: {
  label: string;
  pageHeader: string;
  tone: 'bad' | 'neutral';
  rows: ErrorRowView[];
}) {
  return (
    <Table
      label={label}
      columns={[
        { header: pageHeader },
        { header: 'Status', numeric: true, mono: true },
        { header: 'Linked from' },
      ]}
      rows={rows.map((r) => ({
        // One row per URL and status: a URL that answered two statuses is two rows.
        key: `${r.status} ${r.url}`,
        cells: [
          <PageCell key="p" r={r} />,
          <StatusPill key="s" state={tone}>
            {String(r.status)}
          </StatusPill>,
          <LinkedFrom key="f" r={r} />,
        ],
      }))}
    />
  );
}

/** A section heading and its table, shown only when it has a row. */
function ErrorSection({
  heading,
  rows,
  pageHeader,
  tone,
}: {
  heading: string;
  rows: ErrorRowView[];
  pageHeader: string;
  tone: 'bad' | 'neutral';
}) {
  if (!rows.length) return null;
  return (
    <Card as="section" className={styles.panel}>
      <div className={`${layout.row} ${styles.hd}`}>
        <Heading level={2} size="s">
          {heading}
        </Heading>
      </div>
      <ErrorTable label={heading} pageHeader={pageHeader} tone={tone} rows={rows} />
    </Card>
  );
}

function Basics({ col }: { col: BasicsColumnView }) {
  return (
    <Card as="section" className={`${styles.panel} ${own.column}`}>
      <Heading level={2} size="s">
        {col.heading}
      </Heading>
      <div className={own.line}>{col.missingLine}</div>
      {col.missing.shown.length ? <Short list={col.missing} item={path} keyOf={byUrl} /> : null}
      <div className={own.line}>{col.sharedLine}</div>
      {col.shared.shown.length ? (
        <Short
          list={col.shared}
          keyOf={(g) => g.text}
          item={(g) => (
            <div className={own.group}>
              {g.line}
              <Short list={g.pages} item={path} keyOf={byUrl} />
            </div>
          )}
        />
      ) : null}
    </Card>
  );
}

/**
 * Links and pages (row 5): the missing pages a link in the record leads to and the pages of the
 * record that link to them, the missing pages the record links to from 0 pages, the pages that
 * answered another error, redirects, and the titles and meta descriptions that are missing or shared. Headings are not read yet, and
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
          <ErrorTable
            label="Broken links"
            pageHeader="Missing page"
            tone="bad"
            rows={data.broken.rows}
          />
        )}
      </Card>
      <ErrorSection
        heading={data.unlinked.heading}
        rows={data.unlinked.rows}
        pageHeader="Missing page"
        tone="bad"
      />
      <ErrorSection
        heading={data.errors.heading}
        rows={data.errors.rows}
        pageHeader="Page"
        tone="neutral"
      />
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
            columns={[{ header: REQUESTED_AS }, { header: 'Hops' }, { header: 'Ends at' }]}
            rows={data.redirects.rows.map((r) => ({
              key: r.url,
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
