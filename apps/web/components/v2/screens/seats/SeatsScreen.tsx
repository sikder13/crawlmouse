import { Button } from '../../Button';
import { Card } from '../../Card';
import { StatusPill } from '../../StatusPill';
import { Table } from '../../Table';
import { VisuallyHidden } from '../../VisuallyHidden';
import { SEATS_COPY } from '../../../../lib/v2/copy/seats';
import type { SeatsView } from '../../../../lib/v2/view/seats';
import { AccountFrame } from '../account/AccountFrame';
import { CardHead } from '../account/parts';
import shared from '../account/AccountScreen.module.css';
import { BuyForm, ChangeSeat, InviteForm } from './SeatForms';
import styles from './SeatsScreen.module.css';

const C = SEATS_COPY.columns;

/**
 * Final-Ag-Seats: who holds a seat, what each role can do, and, for a reader who may, the invite
 * form and the plan's extra seats and sites. The one orange element is "Invite someone", the link to
 * the invite form. `notice` is the line of a form the routes sent back.
 */
export function SeatsScreen({
  data,
  notice = null,
}: {
  data: SeatsView;
  notice?: { text: string } | null;
}) {
  const { header, people, roles, invite, buy } = data;
  return (
    <AccountFrame shell={data.shell}>
      <header className={shared.header}>
        <div>
          <h1 className={shared.title}>{header.title}</h1>
          <div className={shared.line}>{header.line}</div>
        </div>
        {header.invite ? (
          <div className={shared.headActions}>
            <Button href={header.invite.href} variant="primary">
              {header.invite.label}
            </Button>
          </div>
        ) : null}
      </header>

      {notice ? (
        <p className={shared.note} role="status" data-v2-addition="">
          {notice.text}
        </p>
      ) : null}

      <Card as="section" className={shared.panel}>
        <CardHead title={people.title} sub={people.sub} />
        <Table
          label={SEATS_COPY.tables.seats}
          rowHeader
          columns={[
            { header: C.person },
            { header: C.role },
            { header: C.clients, muted: true },
            { header: C.alerts, muted: true },
            { header: <VisuallyHidden>{C.actions}</VisuallyHidden>, numeric: true },
          ]}
          rows={people.rows.map((r) => ({
            key: r.key,
            cells: [
              <div key="p">
                <div className={styles.name}>{r.person}</div>
                {r.email ? <div className={styles.email}>{r.email}</div> : null}
                {r.invited ? (
                  <div data-v2-addition="">
                    <StatusPill state="neutral">{SEATS_COPY.invited}</StatusPill>
                  </div>
                ) : null}
              </div>,
              r.role,
              r.clients,
              r.alerts,
              r.change ? <ChangeSeat key="c" seat={r.change} who={r.person} /> : null,
            ],
          }))}
        />
        {people.foot ? <div className={shared.foot}>{people.foot}</div> : null}
        <p className={styles.mailNote}>{people.mailNote}</p>
      </Card>

      <Card as="section" className={shared.panel}>
        <CardHead title={roles.title} />
        <Table
          label={SEATS_COPY.tables.roles}
          rowHeader
          columns={roles.columns.map((header, i) => ({ header, numeric: i > 0 }))}
          rows={roles.rows.map((r) => ({
            key: r.can,
            cells: [
              r.can,
              ...r.cells.map((yes, i) =>
                yes ? (
                  <StatusPill key={i} state="ok">
                    {SEATS_COPY.yes}
                  </StatusPill>
                ) : (
                  <span key={i} className={shared.muted}>
                    {SEATS_COPY.no}
                  </span>
                ),
              ),
            ],
          }))}
        />
      </Card>

      {invite ? (
        <div data-v2-addition="">
          <Card as="section" id={invite.id} className={shared.panel}>
            <CardHead title={SEATS_COPY.form.title} />
            <div className={styles.formWrap}>
              <InviteForm invite={invite} />
            </div>
          </Card>
        </div>
      ) : null}

      {buy ? (
        <div data-v2-addition="">
          <Card as="section" className={shared.panel}>
            <CardHead title={SEATS_COPY.buy.title} sub={buy.line} />
            <div className={styles.formWrap}>
              <BuyForm buy={buy} />
            </div>
          </Card>
        </div>
      ) : null}
    </AccountFrame>
  );
}
