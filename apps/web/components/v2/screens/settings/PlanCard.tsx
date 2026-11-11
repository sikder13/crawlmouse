import { Card } from '../../Card';
import { Table } from '../../Table';
import type { SettingsView } from '../../../../lib/v2/view/settings';
import { ActionControl } from '../account/ActionControl';
import { CardHead } from '../account/parts';
import shared from '../account/AccountScreen.module.css';
import styles from './SettingsScreen.module.css';

/**
 * The plan card: the plan and its days, usage against the limits, the Keep, the prices and the
 * terms. Settings carries it beside the account's forms; Settings › Plan carries it alone.
 */
export function PlanCard({
  plan,
  columns: C,
}: {
  plan: SettingsView['plan'];
  columns: SettingsView['columns'];
}) {
  return (
    <Card as="section" className={shared.panel}>
      <CardHead title={plan.title} />
      <div className={styles.plan}>
        <div className={styles.planHead}>
          <span className={styles.planName}>{plan.name}</span>
          {plan.left ? <span className={shared.mono}>{plan.left}</span> : null}
        </div>
        {plan.note ? <div className={styles.hint}>{plan.note}</div> : null}
        <Table
          label={plan.usageLabel}
          headersHidden
          rowHeader
          className={styles.usage}
          columns={[{ header: C.item }, { header: C.value, numeric: true, mono: true }]}
          rows={plan.usage.map(([label, value]) => ({ key: label, cells: [label, value] }))}
        />
        {plan.keep ? (
          <div className={styles.keep}>
            <ActionControl action={plan.keep} size="md" />
          </div>
        ) : null}
        <div className={styles.hint}>
          {plan.other}{' '}
          <a href={plan.compare.href} className={styles.inlineLink}>
            {plan.compare.label}
          </a>
        </div>
        <Table
          label={plan.termsLabel}
          headersHidden
          rowHeader
          className={styles.usage}
          columns={[{ header: C.item }, { header: C.detail }]}
          rows={plan.terms.map((t) => ({
            key: t.label,
            cells: [
              t.label,
              <span key="t" className={styles.term}>
                <span className={shared.muted}>{t.text}</span>
                {t.action ? <ActionControl action={t.action} variant="quiet" /> : null}
              </span>,
            ],
          }))}
        />
      </div>
    </Card>
  );
}
