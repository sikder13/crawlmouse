import { Button } from '../../Button';
import { Card } from '../../Card';
import { Select } from '../../Select';
import { Table } from '../../Table';
import { VisuallyHidden } from '../../VisuallyHidden';
import { REPORTS_COPY } from '../../../../lib/v2/copy/reports';
import type { ReportsView } from '../../../../lib/v2/view/reports';
import { AccountFrame } from '../account/AccountFrame';
import { ActionControl } from '../account/ActionControl';
import { CardHead } from '../account/parts';
import shared from '../account/AccountScreen.module.css';
import styles from './ReportsScreen.module.css';

const C = REPORTS_COPY.columns;
const T = REPORTS_COPY.table;

/**
 * Final-Reports: make a report for one site (its picker reloads the card for another), the reports
 * the account has made, and the client reports scheduled. The one orange element is "Make the PDF".
 */
export function ReportsScreen({ data }: { data: ReportsView }) {
  const { header, make, made, scheduled } = data;
  return (
    <AccountFrame shell={data.shell}>
      <header className={shared.header}>
        <div>
          <h1 className={shared.title}>{header.title}</h1>
          <div className={shared.line}>{header.line}</div>
        </div>
      </header>

      <Card as="section" className={shared.panel}>
        <CardHead title={make.title} sub={make.sub}>
          {make.sites.length ? (
            <form method="get" action={make.pick.href} className={styles.pick}>
              <Select
                id="report-site"
                label={make.pick.label}
                hideLabel
                name="site"
                options={make.sites}
                defaultValue={make.selected}
              />
              <span data-v2-addition="">
                <Button type="submit" variant="quiet" size="sm">
                  {make.pick.show}
                </Button>
              </span>
            </form>
          ) : null}
        </CardHead>
        <div className={styles.options}>
          <div className={styles.option}>
            <div>
              <div className={styles.optionTitle}>{make.pdf.title}</div>
              <div className={styles.optionText}>{make.pdf.text}</div>
            </div>
            {make.pdf.action ? <ActionControl action={make.pdf.action} size="md" /> : null}
          </div>
          <div className={styles.option}>
            <div>
              <div className={styles.optionTitle}>{make.compare.title}</div>
              <div className={styles.optionText}>{make.compare.text}</div>
            </div>
          </div>
          <div className={styles.option}>
            <div>
              <div className={styles.optionTitle}>{make.raw.title}</div>
              <div className={styles.optionText}>{make.raw.text}</div>
            </div>
            {make.raw.actions.length ? (
              <div className={styles.buttons}>
                {make.raw.actions.map((a) => (
                  <ActionControl key={a.label} action={a} variant="quiet" />
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </Card>

      <Card as="section" className={shared.panel}>
        <CardHead title={made.title} sub={made.sub} />
        {made.rows.length ? (
          <Table
            label={T.made}
            columns={[
              { header: C.made },
              { header: C.site, mono: true },
              { header: C.type },
              { header: C.covers },
              { header: <VisuallyHidden>{C.actions}</VisuallyHidden>, numeric: true },
            ]}
            rows={made.rows.map((r) => ({
              key: r.key,
              cells: [
                <span key="m" className={styles.nowrap}>
                  {r.made}
                </span>,
                r.site,
                r.type,
                <span key="c" className={styles.muted}>
                  {r.covers}
                </span>,
                <div key="a" className={styles.rowActions}>
                  {r.actions.map((a) => (
                    <ActionControl key={a.label} action={a} variant="quiet" />
                  ))}
                </div>,
              ],
            }))}
          />
        ) : (
          <p className={styles.empty}>{made.empty}</p>
        )}
        <div className={shared.foot}>{made.foot}</div>
      </Card>

      <Card as="section" className={shared.panel}>
        <CardHead title={scheduled.title} sub={scheduled.sub} />
        {scheduled.rows.length ? (
          <Table
            label={T.scheduled}
            columns={[
              { header: C.when },
              { header: C.site, mono: true },
              { header: C.type },
              { header: C.to, mono: true },
              { header: C.status },
            ]}
            rows={scheduled.rows.map((r) => ({
              key: r.key,
              cells: [
                <span key="w" className={styles.nowrap}>
                  {r.when}
                </span>,
                r.site,
                r.type,
                r.to,
                r.status,
              ],
            }))}
          />
        ) : null}
        <p className={styles.note}>
          {scheduled.foot}
          {scheduled.compare ? (
            <>
              {' '}
              <a href={scheduled.compare.href}>{scheduled.compare.label}</a>
            </>
          ) : null}
        </p>
      </Card>
    </AccountFrame>
  );
}
