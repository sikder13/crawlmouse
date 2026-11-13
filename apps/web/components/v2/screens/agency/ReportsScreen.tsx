import { Card } from '../../Card';
import { StatusPill, type PillState } from '../../StatusPill';
import { Table } from '../../Table';
import { VisuallyHidden } from '../../VisuallyHidden';
import { CLIENT_REPORTS_COPY as COPY } from '../../../../lib/v2/copy/client-reports';
import type {
  ClientReportRowView,
  ClientReportsPageView,
  ClientReportsView,
  ContactState,
} from '../../../../lib/v2/view/agency-reports';
import { AccountFrame } from '../account/AccountFrame';
import { ActionControl } from '../account/ActionControl';
import { Notice, type NoticeView } from '../account/Notice';
import { CardHead } from '../account/parts';
import shared from '../account/AccountScreen.module.css';
import { MatrixScreen } from './MatrixScreen';
import { ClientForm, ScheduleForm } from './ReportsForms';
import styles from './AgencyScreen.module.css';

/** Where a contact stands, as a status: its colour and shape (DESIGN-LOCK rule 7). */
const CONTACT_PILL: Record<Exclude<ContactState, 'none'>, PillState> = {
  confirmed: 'ok',
  asked: 'unverified',
  not_asked: 'unverified',
  paused: 'warn',
};

function Contact({ contact }: { contact: ClientReportRowView['contact'] }) {
  if (contact.state === 'none') return <span className={shared.muted}>{contact.label}</span>;
  return (
    <span className={styles.contact} data-v2-contact={contact.state}>
      <span className={shared.mono}>{contact.address}</span>
      <StatusPill state={CONTACT_PILL[contact.state]}>{contact.label}</StatusPill>
    </span>
  );
}

function Clients({ clients }: { clients: ClientReportsView['clients'] }) {
  const C = COPY.columns;
  // A reader who may not schedule has no action on a row, so the table has no column for one.
  const acts = clients.rows.some((r) => r.actions.length > 0);
  return (
    <Card as="section" className={shared.panel}>
      <CardHead title={clients.title} sub={clients.sub} />
      {clients.rows.length ? (
        <Table
          label={COPY.clientsLabel}
          rowHeader
          columns={[
            { header: C.client },
            { header: C.contact },
            { header: C.schedule },
            { header: C.nextRun, muted: true },
            { header: C.owner, muted: true },
            ...(acts
              ? [{ header: <VisuallyHidden>{C.actions}</VisuallyHidden>, numeric: true }]
              : []),
          ]}
          rows={clients.rows.map((r) => ({
            key: r.key,
            cells: [
              <span key="c" className={styles.client}>
                <a href={r.href}>{r.client ?? r.host}</a>
                {r.client ? <span className={styles.host}>{r.host}</span> : null}
              </span>,
              <Contact key="t" contact={r.contact} />,
              r.schedule,
              r.nextRun,
              r.seat,
              ...(acts
                ? [
                    <span key="a" className={styles.rowActions} data-v2-addition="">
                      {r.actions.map((a) => (
                        <ActionControl key={a.label} action={a} variant="quiet" />
                      ))}
                    </span>,
                  ]
                : []),
            ],
          }))}
        />
      ) : (
        <p className={shared.note}>{clients.empty}</p>
      )}
    </Card>
  );
}

/** The chosen client's forms (an addition: the artboard draws no form). */
function Change({ change }: { change: NonNullable<ClientReportsView['change']> }) {
  return (
    <div data-v2-addition="" data-v2-client-change="">
      <Card as="section" id={change.id} className={shared.panel}>
        <CardHead title={change.title} sub={change.host}>
          {change.stop ? <ActionControl action={change.stop} variant="quiet" /> : null}
        </CardHead>
        <div className={`${shared.two} ${styles.forms}`}>
          <ClientForm client={change.client} />
          <ScheduleForm schedule={change.schedule} />
        </div>
      </Card>
    </div>
  );
}

function Sent({ sent }: { sent: ClientReportsView['sent'] }) {
  const C = COPY.sentColumns;
  const opens = sent.rows.some((r) => r.open !== null);
  return (
    <Card as="section" className={shared.panel}>
      <CardHead title={sent.title} sub={sent.sub || null} />
      {sent.rows.length ? (
        <Table
          label={COPY.sentLabel}
          rowHeader
          columns={[
            { header: C.sent, muted: true },
            { header: C.client, mono: true },
            { header: C.to, mono: true, muted: true },
            ...(opens
              ? [{ header: <VisuallyHidden>{C.actions}</VisuallyHidden>, numeric: true }]
              : []),
          ]}
          rows={sent.rows.map((r) => ({
            key: r.key,
            cells: [
              <span key="s" className={styles.nowrap}>
                {r.sent}
              </span>,
              r.host,
              r.to,
              ...(opens
                ? [
                    r.open ? (
                      <span key="o" data-v2-addition="">
                        <ActionControl action={r.open} variant="quiet" />
                      </span>
                    ) : null,
                  ]
                : []),
            ],
          }))}
        />
      ) : (
        <p className={shared.note}>{sent.empty}</p>
      )}
    </Card>
  );
}

/**
 * `/agency/reports` (Final-Ag-Reports): each client's contact, schedule and next run, the forms that
 * change one client for a reader who may schedule reports, and the client reports sent. Below Agency
 * it is the gate, and for a reader acting in another account the switch, as `/agency` draws them.
 * The orange element is the header's action or the open form's submit, outside the tables, which
 * scroll on a phone (DESIGN-LOCK §3 rule 5; `__tests__/v2/agency.test.tsx` looks in the tables of
 * the two previews that have one).
 */
export function ClientReportsScreen({
  data,
  notice,
}: {
  data: ClientReportsPageView;
  /** What a form posted from this page did, or why it was refused (lib/v2/copy/notices.ts). */
  notice?: NoticeView | null;
}) {
  if (data.kind !== 'reports') return <MatrixScreen data={data} />;
  const { header, trialNote, clients, change, sent } = data;
  return (
    <AccountFrame shell={data.shell} currentIs="location">
      <header className={shared.header}>
        <div>
          <h1 className={shared.title}>{header.title}</h1>
          <div className={shared.line}>{header.line}</div>
        </div>
        {header.action ? (
          <div className={shared.actions} data-v2-addition="">
            <ActionControl action={header.action} size="md" />
          </div>
        ) : null}
      </header>
      <Notice notice={notice} />
      {trialNote ? (
        <p className={styles.trialNote} data-v2-addition="" data-v2-trial-note="">
          {trialNote}
        </p>
      ) : null}
      <Clients clients={clients} />
      {change ? <Change change={change} /> : null}
      <Sent sent={sent} />
    </AccountFrame>
  );
}
