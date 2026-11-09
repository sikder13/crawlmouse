import { Card } from '../../Card';
import { StatusPill } from '../../StatusPill';
import { Switch } from '../../Switch';
import { Table } from '../../Table';
import { VisuallyHidden } from '../../VisuallyHidden';
import { ALERTS_TABLES } from '../../../../lib/v2/copy/alerts';
import type { AlertsView } from '../../../../lib/v2/view/alerts';
import { AccountFrame } from '../account/AccountFrame';
import { ActionControl } from '../account/ActionControl';
import { CardHead } from '../account/parts';
import shared from '../account/AccountScreen.module.css';
import settings from '../settings/SettingsTable.module.css';
import styles from './AlertsScreen.module.css';

const T = ALERTS_TABLES;

/**
 * Final-Alerts: what was sent, newest first, one row per change (D4); where alerts go; and the
 * account's rules. The one orange action opens the fix for the block that is still open.
 */
export function AlertsScreen({ data }: { data: AlertsView }) {
  const { header, fired, channels, rules } = data;
  return (
    <AccountFrame shell={data.shell}>
      <header className={shared.header}>
        <div>
          <h1 className={shared.title}>{header.title}</h1>
          <div className={shared.line} data-v2-verdicts={header.verdicts.join(' ')}>
            {header.line}
          </div>
        </div>
        {header.actions.length ? (
          <div className={shared.actions}>
            {header.actions.map((a) => (
              <ActionControl key={a.label} action={a} size="md" />
            ))}
          </div>
        ) : null}
      </header>

      <Card as="section" className={shared.panel}>
        <CardHead title={fired.title} sub={fired.sub} />
        {fired.rows.length ? (
          <Table
            label={T.fired}
            columns={[
              { header: T.when },
              { header: T.site, mono: true },
              { header: T.what },
              { header: T.to },
              { header: <VisuallyHidden>{T.open}</VisuallyHidden>, numeric: true },
            ]}
            rows={fired.rows.map((r) => ({
              key: r.key,
              cells: [
                <span key="w" className={styles.when}>
                  {r.when}
                </span>,
                r.site,
                <span key="x" data-v2-verdicts={r.verdicts.join(' ')}>
                  <StatusPill state={r.pill.state}>{r.pill.label}</StatusPill> {r.what}
                </span>,
                <span key="t" className={styles.to}>
                  {r.to}
                </span>,
                <ActionControl key="o" action={r.open} variant={r.lead ? 'default' : 'quiet'} />,
              ],
            }))}
          />
        ) : (
          <p className={styles.empty}>{fired.empty}</p>
        )}
        {fired.foot ? <div className={shared.foot}>{fired.foot}</div> : null}
      </Card>

      <div className={`${shared.two} ${shared.twoWide}`}>
        <Card as="section" className={shared.panel}>
          <CardHead title={channels.title} />
          <Table
            label={T.channels}
            headersHidden
            rowHeader
            className={settings.settings}
            columns={[
              { header: T.channel },
              { header: T.address },
              { header: T.state, numeric: true },
            ]}
            rows={channels.rows.map((r) => ({
              key: r.label,
              cells: [
                r.label,
                <span key="v" className={r.data ? shared.mono : shared.muted}>
                  {r.value}
                </span>,
                r.state ? (
                  <StatusPill key="s" state={r.state.state}>
                    {r.state.label}
                  </StatusPill>
                ) : r.action ? (
                  <ActionControl key="a" action={r.action} variant="quiet" />
                ) : null,
              ],
            }))}
          />
          <div className={shared.foot}>{channels.foot}</div>
        </Card>

        <Card as="section" className={shared.panel}>
          <CardHead title={rules.title} />
          {rules.rows.length ? (
            <Table
              label={T.rules}
              headersHidden
              rowHeader
              className={settings.settings}
              columns={[{ header: T.rule }, { header: T.on, numeric: true }]}
              rows={rules.rows.map((r) => ({
                key: r.key,
                cells: [
                  <span key="l" data-v2-verdicts={r.verdicts.join(' ')}>
                    {r.label}
                  </span>,
                  <Switch
                    key="s"
                    label={r.label}
                    name="enabled"
                    on={r.on}
                    action={r.toggle.href}
                    fields={r.toggle.fields}
                  />,
                ],
              }))}
            />
          ) : (
            <p className={styles.empty}>{rules.empty}</p>
          )}
          {rules.foot ? <div className={shared.foot}>{rules.foot}</div> : null}
        </Card>
      </div>
    </AccountFrame>
  );
}
