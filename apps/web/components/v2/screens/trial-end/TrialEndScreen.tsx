import { Card } from '../../Card';
import { Table } from '../../Table';
import type { TrialEndView, TrialRowView } from '../../../../lib/v2/view/trial-end';
import { AccountFrame } from '../account/AccountFrame';
import { ActionControl } from '../account/ActionControl';
import { CardHead } from '../account/parts';
import shared from '../account/AccountScreen.module.css';
import settings from '../settings/SettingsTable.module.css';
import styles from './TrialEndScreen.module.css';

/** "Stays, on Free" or "Pauses, until Pro": what it is, then what happens to it. */
function List({
  title,
  label,
  rows,
  columns,
}: {
  title: string;
  label: string;
  rows: TrialRowView[];
  columns: TrialEndView['columns'];
}) {
  return (
    <section className={styles.list}>
      <h3 className={styles.listHead}>{title}</h3>
      <Table
        label={label}
        headersHidden
        rowHeader
        className={settings.settings}
        columns={[{ header: columns.what }, { header: columns.how }]}
        rows={rows.map((r) => ({
          key: r.what,
          cells: [
            r.what,
            <span key="h" className={styles.muted}>
              {r.how}
            </span>,
          ],
        }))}
      />
    </section>
  );
}

/**
 * Final-TrialEnd, read at the reminder three days before the trial ends: what changes and what does
 * not, what the trial did, and the two choices. The one orange element keeps the plan; the rail's
 * trial card leaves the plan to this page (`plan: 'page'`).
 */
export function TrialEndScreen({ data }: { data: TrialEndView }) {
  const { header, banner, did, columns, tables } = data;
  return (
    <AccountFrame shell={data.shell}>
      <header className={shared.header}>
        <div>
          <h1 className={shared.title}>{header.title}</h1>
          <div className={shared.line}>{header.line}</div>
        </div>
        <div className={shared.actions}>
          {header.actions.map((a) => (
            <ActionControl key={a.label} action={a} />
          ))}
        </div>
      </header>

      <Card as="section" className={styles.banner}>
        <div className={styles.bannerHead}>
          <div className={styles.bannerText}>
            <h2 className={styles.bannerTitle}>{banner.title}</h2>
            <div className={styles.bannerSub}>{banner.sub}</div>
          </div>
          <div className={shared.actions}>
            <ActionControl action={banner.keep} size="md" />
            <ActionControl action={banner.end} variant="quiet" size="md" />
          </div>
        </div>
        <div className={styles.lists}>
          <List title={data.staysTitle} label={tables.stays} rows={data.stays} columns={columns} />
          <List
            title={data.pausesTitle}
            label={tables.pauses}
            rows={data.pauses}
            columns={columns}
          />
        </div>
      </Card>

      <Card as="section" className={shared.panel}>
        <CardHead title={did.title} sub={did.sub} />
        <Table
          label={tables.did}
          headersHidden
          rowHeader
          columns={[
            { header: columns.item },
            { header: columns.value, numeric: true, mono: true },
            { header: columns.detail },
          ]}
          rows={did.rows.map((r) => ({
            key: r.label,
            cells: [
              r.label,
              r.value,
              <span key="d" className={styles.muted} data-v2-verdicts={r.verdicts.join(' ')}>
                {r.detail}
              </span>,
            ],
          }))}
        />
      </Card>

      <div className={shared.two}>
        <Card as="section" className={shared.panel}>
          <CardHead title={data.keepTitle} />
          <p className={styles.text}>{data.keepText}</p>
        </Card>
        <Card as="section" className={shared.panel}>
          <CardHead title={data.endTitle} />
          <p className={styles.text}>{data.endText}</p>
        </Card>
      </div>
    </AccountFrame>
  );
}
