import { Button } from '../../Button';
import { Card } from '../../Card';
import { Switch } from '../../Switch';
import { Table } from '../../Table';
import type { FieldView, SettingsView } from '../../../../lib/v2/view/settings';
import { AccountFrame } from '../account/AccountFrame';
import { ActionControl } from '../account/ActionControl';
import { CardHead } from '../account/parts';
import field from '../../Field.module.css';
import shared from '../account/AccountScreen.module.css';
import { PlanCard } from './PlanCard';
import { StoppedForm } from './StoppedForm';
import settings from './SettingsTable.module.css';
import styles from './SettingsScreen.module.css';

/**
 * A labelled input pre-filled with the account's value, its hint tied to it. A raw input with the
 * Field primitive's styles, as CC-25's sign-up form does, because Field takes no value.
 */
function Input({ f, type }: { f: FieldView; type: 'email' | 'text' }) {
  const hint = `${f.id}-hint`;
  return (
    <div className={field.stack}>
      <label htmlFor={f.id} className={field.label}>
        {f.label}
      </label>
      <input
        id={f.id}
        name={f.name}
        type={type}
        defaultValue={f.value}
        placeholder={f.placeholder ?? undefined}
        aria-describedby={hint}
        className={`${field.input} ${styles.input} ${type === 'email' ? '' : styles.text}`}
      />
      <div id={hint} className={styles.hint}>
        {f.hint}
      </div>
    </div>
  );
}

/**
 * Final-Settings: the account's address and name, its three kinds of email, deleting it, and its
 * plan. The one orange element is Save. Nothing posts in the preview (CC-27b builds the routes).
 */
export function SettingsScreen({ data }: { data: SettingsView }) {
  const { header, account, email, danger, plan, columns: C } = data;
  return (
    <AccountFrame shell={data.shell}>
      <header className={shared.header}>
        <div>
          <h1 className={shared.title}>{header.title}</h1>
          <div className={shared.line}>{header.line}</div>
        </div>
      </header>

      <div className={styles.columns}>
        <div className={styles.column}>
          <Card as="section" className={shared.panel}>
            <CardHead title={account.title} />
            <StoppedForm action={account.save.href} className={styles.form}>
              {Object.entries(account.save.fields).map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
              ))}
              <Input f={account.email} type="email" />
              <Input f={account.name} type="text" />
              <div className={styles.signIn}>
                <span className={styles.signInTitle}>{account.signIn.title}</span>
                <div className={styles.hint}>{account.signIn.text}</div>
              </div>
              <div>
                <Button type="submit" variant="primary">
                  {account.save.label}
                </Button>
              </div>
            </StoppedForm>
          </Card>

          <Card as="section" className={shared.panel}>
            <CardHead title={email.title} />
            <Table
              label={email.tableLabel}
              headersHidden
              rowHeader
              className={settings.settings}
              columns={[
                { header: C.kind },
                { header: C.detail },
                { header: C.control, numeric: true },
              ]}
              rows={email.rows.map((r) => ({
                key: r.kind,
                cells: [
                  r.label,
                  <span key="d" className={shared.muted}>
                    {r.detail}
                  </span>,
                  'always' in r.control ? (
                    <span key="c" className={shared.muted}>
                      {r.control.always}
                    </span>
                  ) : (
                    <Switch
                      key="c"
                      label={r.label}
                      name={r.control.name}
                      on={r.control.on}
                      action={r.control.action.href}
                      fields={r.control.action.fields}
                    />
                  ),
                ],
              }))}
            />
            <div className={shared.foot}>{email.foot}</div>
          </Card>

          <Card as="section" className={shared.panel}>
            <CardHead title={danger.title} />
            <Table
              label={danger.tableLabel}
              headersHidden
              rowHeader
              className={settings.settings}
              columns={[
                { header: C.item },
                { header: C.detail },
                { header: C.control, numeric: true },
              ]}
              rows={[
                {
                  key: 'delete',
                  cells: [
                    danger.label,
                    <span key="t" className={shared.muted}>
                      {danger.text}
                    </span>,
                    <ActionControl key="a" action={danger.action} variant="quiet" />,
                  ],
                },
              ]}
            />
          </Card>
        </div>

        <div className={styles.column}>
          <PlanCard plan={plan} columns={C} />
        </div>
      </div>
    </AccountFrame>
  );
}
