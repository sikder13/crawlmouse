import { Button } from '../../Button';
import { Card } from '../../Card';
import { Heading } from '../../Heading';
import { StatusPill } from '../../StatusPill';
import { Table, type TableColumn } from '../../Table';
import { VerdictCell } from '../../VerdictCell';
import type { ChangeRowView, ChangesView } from '../../../../lib/v2/view/segment/changes';
import { SegmentShell } from './SegmentShell';
import { VerdictCard } from './SegmentParts';
import layout from '../../layout.module.css';
import styles from './SegmentScreen.module.css';
import own from './ChangesScreen.module.css';

/**
 * Change rows, the site's own and the example's alike. The pages and who-was-told columns appear
 * only when the rows carry them (the example does not).
 */
function ChangeTable({ label, rows }: { label: string; rows: ChangeRowView[] }) {
  const pages = rows.some((r) => r.pages !== null);
  const told = rows.some((r) => r.told !== null);
  const columns: TableColumn[] = [
    { header: 'When', mono: true, muted: true },
    { header: 'What changed' },
    { header: 'Where', mono: true },
    ...(pages ? [{ header: 'Pages', numeric: true }] : []),
    { header: 'Effect', mono: true },
    { header: 'Cause we found' },
    ...(told ? [{ header: 'Who was told' }] : []),
  ];
  return (
    <Table
      label={label}
      columns={columns}
      rows={rows.map((r) => ({
        key: r.key,
        cells: [
          <span key="w" className={own.when}>
            {r.when}
          </span>,
          <span key="c" className={own.what}>
            <StatusPill state={r.pill.state}>{r.pill.label}</StatusPill> {r.summary}
            {r.subject ? <span className={own.subject}>· {r.subject}</span> : null}
            {r.verdict ? (
              <VerdictCell verdict={r.verdict.verdict} evidence={r.verdict.evidence} />
            ) : null}
          </span>,
          r.where,
          ...(pages ? [r.pages ?? '—'] : []),
          r.effect,
          <>
            {r.cause}
            {r.diff.length ? (
              <pre className={own.diff}>{r.diff.map((l) => `${l.sign} ${l.line}`).join('\n')}</pre>
            ) : null}
          </>,
          ...(told ? [r.told ?? '—'] : []),
        ],
      }))}
    />
  );
}

/**
 * Changes (Final-Seg-Changes): on a first audit, why there is nothing yet and what a change will
 * look like; after a re-check, the changes it found. Then the site's audits.
 */
export function ChangesScreen({ data }: { data: ChangesView }) {
  const { frame } = data;
  const keep = data.keep ? { ...data.keep, primary: true } : null;
  return (
    <SegmentShell frame={frame} keep={keep} nextPrimary={false}>
      <VerdictCard
        title={data.headline.title}
        pill={data.headline.pill}
        body={data.body}
        tiles={data.tiles}
        coverage={data.coverage}
      />
      {data.example ? (
        <Card as="section" className={styles.panel}>
          <div className={`${layout.row} ${styles.hd}`}>
            <div>
              <Heading level={2} size="s">
                What a change looks like here
              </Heading>
              <div className={styles.sub}>
                An example from another store, names removed, so you know what the email and this
                list will say. Your own rows start with the second check.
              </div>
            </div>
            <StatusPill state="neutral">example</StatusPill>
          </div>
          <ChangeTable label="Example change log" rows={data.example} />
          <div className={own.foot}>
            One email per check that finds a change, from alerts@crawlmouse.com, with the rows above
            in it. Checks that find nothing send nothing.
          </div>
        </Card>
      ) : (
        <Card as="section" className={styles.panel}>
          <div className={`${layout.row} ${styles.hd}`}>
            <Heading level={2} size="s">
              What this check found
            </Heading>
          </div>
          <ChangeTable label="Changes found at this check" rows={data.rows} />
        </Card>
      )}
      <Card as="section" className={own.history}>
        <Heading level={2} size="s">
          Your audit history
        </Heading>
        {data.history.length === 1 ? (
          // One audit is not a list: the row the locked page draws.
          <div className={`${layout.row} ${own.historyRow}`}>
            <span className={own.historyWhen}>{data.history[0]!.when}</span>
            <span>{data.history[0]!.label}</span>
            <Button variant="quiet" size="sm" href={frame.tabs[0]!.href}>
              Open
            </Button>
          </div>
        ) : (
          <Table
            className={own.historyTable}
            label="Your audit history"
            columns={[
              { header: <span data-v2-addition="">Finished</span>, mono: true },
              { header: <span data-v2-addition="">Audit</span> },
              { header: <span data-v2-addition="">Result</span> },
            ]}
            rows={data.history.map((h, i) => ({
              key: h.key,
              cells: [
                h.when,
                h.label,
                <Button
                  key="o"
                  variant="quiet"
                  size="sm"
                  href={i === 0 ? frame.tabs[0]!.href : '#'}
                >
                  Open
                </Button>,
              ],
            }))}
          />
        )}
        {data.historyNote ? <div className={own.note}>{data.historyNote}</div> : null}
      </Card>
    </SegmentShell>
  );
}
