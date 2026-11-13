import type { ReactNode } from 'react';
import type { AccountView } from '../../../../lib/v2/ops/console-view';
import { REASON_MAX } from '../../../../lib/v2/ops/actions';
import { Button } from '../../Button';
import { Card } from '../../Card';
import { Heading } from '../../Heading';
import { PageShell } from '../../PageShell';
import { StatusPill } from '../../StatusPill';
import { Table, type TableColumn, type TableRow } from '../../Table';
import layout from '../../layout.module.css';
import styles from './Console.module.css';

export interface ConsoleAccountProps {
  view: AccountView;
  /** The line for the action the page was sent back from, if any. */
  notice: string | null;
}

function Section({
  title,
  columns,
  rows,
  empty,
  withheld = 0,
  note = null,
}: {
  title: string;
  columns: TableColumn[];
  rows: TableRow[];
  empty: string;
  /** How many rows the list has that it does not show. */
  withheld?: number;
  note?: string | null;
}) {
  return (
    <Card as="section" className={styles.panel} aria-label={title}>
      <Heading level={2} size="s">
        {title}
      </Heading>
      {rows.length ? (
        <Table label={title} columns={columns} rows={rows} />
      ) : (
        <p className={styles.empty}>{empty}</p>
      )}
      {withheld > 0 ? <p className={styles.empty}>{withheld} more not shown.</p> : null}
      {note ? <p className={styles.empty}>{note}</p> : null}
    </Card>
  );
}

/** A POST form with the required reason, for one of the console's two actions. */
function ActionForm({
  action,
  label,
  hidden,
  children,
}: {
  action: string;
  label: string;
  hidden?: Record<string, string>;
  children: ReactNode;
}) {
  return (
    <form method="post" action={action} className={styles.action} aria-label={label}>
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <input
        className={styles.reason}
        name="reason"
        type="text"
        required
        maxLength={REASON_MAX}
        placeholder="Reason"
        aria-label={`Reason: ${label}`}
      />
      <Button type="submit" size="sm">
        {children}
      </Button>
    </form>
  );
}

/**
 * One account in the support console (CC-33 D2): its plan and history, seats, sites, last checks,
 * mail, alerts and open fixes, read with the service role after the operator check and recorded as a
 * view before they were read. The two actions are forms with a required reason; a check is offered a
 * re-run only when it failed on a site that is kept, and a seat a sign-in link only when it is active.
 * Staff tooling: no artboard.
 */
export function ConsoleAccountScreen({ view: v, notice }: ConsoleAccountProps) {
  return (
    <PageShell header="app" footer={false}>
      {/* PostHog is set up for every page (instrumentation-client.ts): `ph-no-capture` keeps its
          autocapture off this staff page, and `data-ph-mask` masks its text in an error replay. */}
      <main className={`${layout.wrap} ${styles.main} ph-no-capture`} data-ph-mask="">
        <div className={styles.header}>
          <a href="/internal">Support console</a>
        </div>
        <div className={styles.header}>
          <Heading level={1} size="l">
            {v.heading}
          </Heading>
          {v.internal ? <StatusPill state="warn">Internal</StatusPill> : null}
          {v.deleted ? <StatusPill state="bad">Deleted</StatusPill> : null}
        </div>
        {notice ? (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        ) : null}

        <Card as="section" className={styles.panel} aria-label="Plan">
          <Heading level={2} size="s">
            Plan
          </Heading>
          <dl className={styles.facts}>
            {v.facts.map((f) => (
              <div key={f.label} style={{ display: 'contents' }}>
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
            <dt>Stripe customer</dt>
            <dd>
              {v.stripe === null ? (
                '—'
              ) : v.stripe.href === null ? (
                v.stripe.id
              ) : (
                <a href={v.stripe.href} target="_blank" rel="noreferrer">
                  {v.stripe.id}
                </a>
              )}
            </dd>
          </dl>
        </Card>

        <Section
          title="Plan history"
          empty="No history recorded."
          columns={[{ header: 'State' }, { header: 'Since', mono: true }]}
          rows={v.history.map((h, i) => ({ key: String(i), cells: [h.state, h.since] }))}
        />

        <Section
          title="Seats"
          withheld={v.withheld.seats}
          empty="No seats."
          columns={[
            { header: 'Email' },
            { header: 'Role' },
            { header: 'Status' },
            { header: 'Since', mono: true, hideOnPhone: true },
            { header: 'Sign-in link' },
          ]}
          rows={v.seats.map((s) => ({
            key: s.key,
            cells: [
              s.email,
              s.role,
              s.status,
              s.since,
              s.resendUserId === null ? (
                '—'
              ) : (
                <ActionForm
                  action={`/api/internal/accounts/${v.id}/sign-in-link`}
                  label={`Re-send a sign-in link to ${s.email}`}
                  hidden={{ userId: s.resendUserId }}
                >
                  Re-send link
                </ActionForm>
              ),
            ],
          }))}
        />

        <Section
          title="Sites"
          withheld={v.withheld.sites}
          note={v.notes.sites}
          empty="No sites."
          columns={[{ header: 'Host' }, { header: 'State' }]}
          rows={v.sites.map((s) => ({ key: s.key, cells: [s.host, s.state] }))}
        />

        <Section
          title="Last 20 checks"
          withheld={v.withheld.checks}
          empty="No checks."
          columns={[
            { header: 'Queued', mono: true },
            { header: 'Site' },
            { header: 'Trigger' },
            { header: 'Status' },
            { header: 'Failure' },
            { header: 'Started', mono: true, hideOnPhone: true },
            { header: 'Finished', mono: true, hideOnPhone: true },
            { header: 'Check id', mono: true, hideOnPhone: true },
            { header: 'Re-run' },
          ]}
          rows={v.checks.map((c) => ({
            key: c.key,
            cells: [
              c.queued,
              c.host,
              c.trigger,
              <StatusPill key="s" state={c.pill}>
                {c.status}
              </StatusPill>,
              c.failure,
              c.started,
              c.finished,
              c.id,
              c.rerun ? (
                <ActionForm
                  action={`/api/internal/checks/${c.id}/rerun`}
                  label={`Re-run the check queued ${c.queued}`}
                >
                  Re-run
                </ActionForm>
              ) : (
                '—'
              ),
            ],
          }))}
        />

        <Section
          title="Mail sent"
          withheld={v.withheld.mail}
          empty="No mail in the ledger."
          columns={[
            { header: 'Claimed', mono: true },
            { header: 'Kind' },
            { header: 'Status' },
            { header: 'Attempts', numeric: true },
            { header: 'Error' },
            { header: 'Sent', mono: true, hideOnPhone: true },
          ]}
          rows={v.mail.map((m) => ({
            key: m.key,
            cells: [
              m.claimed,
              m.kind,
              <StatusPill key="s" state={m.pill}>
                {m.status}
              </StatusPill>,
              m.attempts,
              m.error,
              m.sent,
            ],
          }))}
        />

        <Section
          title="Alert rules"
          withheld={v.withheld.rules}
          note={v.notes.rules}
          empty="No alert rules."
          columns={[
            { header: 'Kind' },
            { header: 'Scope' },
            { header: 'Enabled' },
            { header: 'Channels' },
            { header: 'Last fired', mono: true },
          ]}
          rows={v.rules.map((r) => ({
            key: r.key,
            cells: [r.kind, r.scope, r.enabled, r.channels, r.lastFired],
          }))}
        />

        <Section
          title="Last 20 alerts"
          withheld={v.withheld.alerts}
          empty="No alerts sent."
          columns={[
            { header: 'Sent', mono: true },
            { header: 'Rule' },
            { header: 'Site' },
            { header: 'Channel' },
            { header: 'Status' },
            { header: 'Reason' },
          ]}
          rows={v.alerts.map((a) => ({
            key: a.key,
            cells: [a.sent, a.kind, a.site, a.channel, a.status, a.reason],
          }))}
        />

        <Section
          title="Open fixes"
          withheld={v.withheld.fixes}
          empty="No open or reopened fixes."
          columns={[
            { header: 'Number', numeric: true },
            { header: 'Type' },
            { header: 'Status' },
            { header: 'Site' },
          ]}
          rows={v.fixes.map((f) => ({ key: f.key, cells: [f.number, f.type, f.status, f.host] }))}
        />
      </main>
    </PageShell>
  );
}
