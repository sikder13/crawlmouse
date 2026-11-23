import { CHANGES_LOG_COPY as COPY } from '../../../../lib/v2/copy/changes-log';
import type { ChangeRowView } from '../../../../lib/v2/view/segment/changes';
import { StatusPill } from '../../StatusPill';
import { Table, type TableColumn } from '../../Table';
import { VerdictCell } from '../../VerdictCell';
import segment from '../segment/ChangesScreen.module.css';
import styles from './ChangesLogScreen.module.css';

/**
 * The account's change rows in five columns, so they fit a desktop window beside the rail (F-100).
 * The site page's table has seven columns and one site; here the time sits under the site, the
 * page count under where, and who was told under the cause.
 */
export function ChangesLogTable({ label, rows }: { label: string; rows: ChangeRowView[] }) {
  const columns: TableColumn[] = [
    { header: COPY.columns.site, mono: true },
    { header: COPY.columns.what },
    { header: COPY.columns.where, mono: true },
    { header: COPY.columns.effect, mono: true },
    { header: COPY.columns.cause },
  ];
  return (
    <Table
      label={label}
      columns={columns}
      rows={rows.map((r) => ({
        key: r.key,
        cells: [
          <span key="s" className={styles.stack}>
            <span className={styles.host}>{r.site ?? '—'}</span>
            <span className={styles.under}>{r.when}</span>
          </span>,
          <span key="c" className={`${segment.what} ${styles.what}`}>
            <StatusPill state={r.pill.state}>{r.pill.label}</StatusPill> {r.summary}
            {r.subject ? <span className={segment.subject}>· {r.subject}</span> : null}
            {r.verdict ? (
              <VerdictCell verdict={r.verdict.verdict} evidence={r.verdict.evidence} />
            ) : null}
          </span>,
          <span key="w" className={styles.stack}>
            <span className={styles.host}>{r.where}</span>
            {r.pages !== null ? <span className={styles.under}>{r.pages}</span> : null}
          </span>,
          r.effect,
          <span key="k" className={styles.cause}>
            {r.cause}
            {r.diff.length ? (
              <pre className={segment.diff}>
                {r.diff.map((l) => `${l.sign} ${l.line}`).join('\n')}
              </pre>
            ) : null}
            {r.told !== null ? <span className={styles.under}>{COPY.told(r.told)}</span> : null}
          </span>,
        ],
      }))}
    />
  );
}
