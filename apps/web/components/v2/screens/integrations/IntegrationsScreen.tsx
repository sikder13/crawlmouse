import { Card } from '../../Card';
import { StatusPill } from '../../StatusPill';
import type { Notice } from '../../../../lib/v2/copy/settings-notices';
import type { IntegrationsView } from '../../../../lib/v2/view/integrations';
import { AccountFrame } from '../account/AccountFrame';
import { ActionControl } from '../account/ActionControl';
import { CardHead } from '../account/parts';
import shared from '../account/AccountScreen.module.css';
import { NoticeLine } from '../settings/NoticeLine';
import styles from './IntegrationsScreen.module.css';

/** Settings › Integrations: the account's Slack destination, and what the last form did. */
export function IntegrationsScreen({
  data,
  notice = null,
}: {
  data: IntegrationsView;
  notice?: Notice | null;
}) {
  const { slack } = data;
  return (
    <AccountFrame shell={data.shell}>
      <header className={shared.header}>
        <div>
          <h1 className={shared.title}>{data.title}</h1>
          <div className={shared.line}>{data.line}</div>
        </div>
      </header>
      <NoticeLine notice={notice} />

      <Card as="section" className={shared.panel}>
        <CardHead title={slack.title} sub={slack.body}>
          <StatusPill state={slack.status.state}>{slack.status.label}</StatusPill>
        </CardHead>
        <div className={styles.body}>
          {slack.connect ? <ActionControl action={slack.connect} size="md" /> : null}
          {slack.disconnect ? (
            <ActionControl action={slack.disconnect} variant="quiet" size="md" />
          ) : null}
          {slack.upgrade ? <ActionControl action={slack.upgrade} size="md" /> : null}
          {slack.help ? (
            <a href={slack.help.href} target="_blank" rel="noreferrer" className={styles.help}>
              {slack.help.label}
            </a>
          ) : null}
        </div>
      </Card>
    </AccountFrame>
  );
}
