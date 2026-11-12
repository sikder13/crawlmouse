import { Card } from '../../Card';
import { StatusPill } from '../../StatusPill';
import { Table } from '../../Table';
import { MATRIX_COPY as COPY } from '../../../../lib/v2/copy/agency';
import type {
  AgencyGateView,
  AgencyHomeView,
  AgencyOpenView,
  ClientRowView,
  MatrixView,
  NextStepView,
} from '../../../../lib/v2/view/agency-matrix';
import { AccountFrame } from '../account/AccountFrame';
import { ActionControl } from '../account/ActionControl';
import { Notice, type NoticeView } from '../account/Notice';
import { CardHead, GradeText } from '../account/parts';
import shared from '../account/AccountScreen.module.css';
import strip from '../dashboard/DashboardScreen.module.css';
import styles from './AgencyScreen.module.css';

function Header({ header }: { header: MatrixView['header'] }) {
  return (
    <header className={shared.header}>
      <div>
        <h1 className={shared.title}>{header.title}</h1>
        <div className={shared.line}>{header.line}</div>
      </div>
      <div className={shared.actions}>
        {header.actions.map((a) => (
          <ActionControl key={a.label} action={a} size={a.primary ? 'md' : 'sm'} />
        ))}
      </div>
    </header>
  );
}

/** Setup's one next step (an addition: the artboard draws an account that is set up). */
function NextStep({ next }: { next: NextStepView }) {
  if (!next.action) return null;
  return (
    <div data-v2-addition="" data-v2-next-step={next.step}>
      <Card as="section" className={shared.panel}>
        <CardHead title={next.title} sub={next.body}>
          <ActionControl action={next.action} size="md" />
        </CardHead>
      </Card>
    </div>
  );
}

/** The counts since each client's previous check; a count of nothing has no cell. */
function Strip({ data }: { data: NonNullable<MatrixView['strip']> }) {
  const cells = [
    { label: COPY.strip.calls, ...data.calls },
    ...(data.opened ? [{ label: COPY.strip.opened, ...data.opened }] : []),
    ...(data.resolved ? [{ label: COPY.strip.resolved, ...data.resolved }] : []),
  ];
  return (
    <Card as="section" className={strip.strip} aria-label={data.label}>
      {cells.map((c) => (
        <div key={c.label} className={strip.cell}>
          <div className={strip.cellLabel}>{c.label}</div>
          <div className={strip.cellRow}>
            <span className={strip.big}>{c.count}</span>
            <span className={strip.noun}>{c.detail}</span>
          </div>
        </div>
      ))}
    </Card>
  );
}

/** What moved since the last check: the pills, the words, or a first check with its one action. */
function Since({ row }: { row: ClientRowView }) {
  if (row.first) {
    return (
      <span className={styles.first}>
        <span className={shared.muted}>{row.first.label}</span>
        <ActionControl action={row.first.action} />
      </span>
    );
  }
  if (row.since.pills.length) {
    return (
      <span className={shared.pills} data-v2-verdicts={row.since.verdicts.join(' ')}>
        {row.since.pills.map((p) => (
          <StatusPill key={p.label} state={p.state}>
            {p.label}
          </StatusPill>
        ))}
      </span>
    );
  }
  return <span className={shared.muted}>{row.sinceLabel}</span>;
}

function Clients({ clients }: { clients: MatrixView['clients'] }) {
  const C = COPY.columns;
  return (
    <Card as="section" className={shared.panel}>
      <CardHead title={clients.title} sub={clients.sub || null} />
      {clients.rows.length ? (
        <Table
          label={COPY.tableLabel}
          rowHeader
          columns={[
            { header: C.site, mono: true },
            { header: C.client },
            { header: C.seo },
            { header: C.ai },
            { header: C.since },
            // The brief's column; the artboard has none for the next check.
            { header: <span data-v2-addition="">{C.next}</span>, muted: true },
            { header: C.last, numeric: true, mono: true, muted: true },
            { header: C.schedule, muted: true },
          ]}
          rows={clients.rows.map((r) => ({
            key: r.key,
            cells: [
              <a key="h" href={r.href}>
                {r.host}
              </a>,
              r.client ?? (
                <span key="n" className={shared.muted}>
                  {COPY.noClientName}
                </span>
              ),
              <GradeText key="s" grade={r.seo} />,
              <GradeText key="a" grade={r.ai} withheld={r.aiWithheld} />,
              <Since key="c" row={r} />,
              <span key="x" data-v2-addition="">
                {r.nextCheck}
              </span>,
              r.lastCheck,
              r.schedule,
            ],
          }))}
        />
      ) : (
        <p className={shared.note}>{clients.empty}</p>
      )}
    </Card>
  );
}

function Matrix({ data, notice }: { data: MatrixView; notice: NoticeView | null | undefined }) {
  return (
    <>
      <Header header={data.header} />
      <Notice notice={notice} />
      {data.next ? <NextStep next={data.next} /> : null}
      {data.strip ? <Strip data={data.strip} /> : null}
      <Clients clients={data.clients} />
    </>
  );
}

/** An account below Agency: what Agency keeps and costs, and the way to the plans. */
function Gate({ data }: { data: AgencyGateView }) {
  return (
    <div className={styles.state} data-v2-addition="" data-v2-agency-state="gate">
      <h1 className={shared.title}>{data.title}</h1>
      <Card as="section" className={styles.message}>
        <p className={styles.body}>{data.message}</p>
        <ActionControl action={data.action} size="md" />
      </Card>
    </div>
  );
}

/** Acting in an account that is not an agency, with a seat on one: the switch to it. */
function Open({ data }: { data: AgencyOpenView }) {
  return (
    <div className={styles.state} data-v2-addition="" data-v2-agency-state="open">
      <h1 className={shared.title}>{data.title}</h1>
      <Card as="section" className={styles.message}>
        <p className={styles.body}>{data.body}</p>
        <div className={shared.actions}>
          {data.agencies.map((a) => (
            <ActionControl key={a.fields.accountId} action={a} size="md" />
          ))}
        </div>
      </Card>
    </div>
  );
}

/**
 * `/agency` (Final-Ag-Matrix): the client matrix on the Agency tier; below it the gate; and for a
 * reader who acts in an account that is not an agency while holding a seat on one, the switch.
 */
export function MatrixScreen({
  data,
  notice,
}: {
  data: AgencyHomeView;
  /** Why a form posted from this page was refused (lib/v2/copy/notices.ts). */
  notice?: NoticeView | null;
}) {
  return (
    <AccountFrame shell={data.shell}>
      {data.kind === 'matrix' ? (
        <Matrix data={data} notice={notice} />
      ) : data.kind === 'gate' ? (
        <Gate data={data} />
      ) : (
        <Open data={data} />
      )}
    </AccountFrame>
  );
}
