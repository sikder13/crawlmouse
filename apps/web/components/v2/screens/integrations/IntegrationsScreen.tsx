import { Card } from '../../Card';
import { StatusPill } from '../../StatusPill';
import type { Notice } from '../../../../lib/v2/copy/settings-notices';
import type { IntegrationCardView, IntegrationsView } from '../../../../lib/v2/view/integrations';
import { AccountFrame } from '../account/AccountFrame';
import { ActionControl } from '../account/ActionControl';
import { CardHead } from '../account/parts';
import shared from '../account/AccountScreen.module.css';
import { NoticeLine } from '../settings/NoticeLine';
import styles from './IntegrationsScreen.module.css';

/** One connection: what it does or holds, its state, and what the reader can do with it. */
function IntegrationCard({ card }: { card: IntegrationCardView }) {
  return (
    <Card as="section" className={shared.panel} data-v2-integration={card.key}>
      <CardHead title={card.title} sub={card.body}>
        <StatusPill state={card.status.state}>{card.status.label}</StatusPill>
      </CardHead>
      <div className={styles.body}>
        {card.connect ? <ActionControl action={card.connect} size="md" /> : null}
        {card.test ? <ActionControl action={card.test} size="md" /> : null}
        {card.disconnect ? (
          <ActionControl action={card.disconnect} variant="quiet" size="md" />
        ) : null}
        {card.upgrade ? <ActionControl action={card.upgrade} size="md" /> : null}
        {card.help ? (
          <a href={card.help.href} target="_blank" rel="noreferrer" className={styles.help}>
            {card.help.label}
          </a>
        ) : null}
      </div>
    </Card>
  );
}

/** Settings › Integrations: the account's connections, and what the last form did. */
export function IntegrationsScreen({
  data,
  notice = null,
}: {
  data: IntegrationsView;
  notice?: Notice | null;
}) {
  return (
    <AccountFrame shell={data.shell}>
      <header className={shared.header}>
        <div>
          <h1 className={shared.title}>{data.title}</h1>
          <div className={shared.line}>{data.line}</div>
        </div>
      </header>
      <NoticeLine notice={notice} />
      {data.cards.map((card) => (
        <IntegrationCard key={card.key} card={card} />
      ))}
    </AccountFrame>
  );
}
