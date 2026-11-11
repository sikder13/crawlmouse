import { Card } from '../../Card';
import { DASHBOARD_COPY } from '../../../../lib/v2/copy/dashboard';
import shared from './AccountScreen.module.css';

const STATES = {
  no_account: { title: DASHBOARD_COPY.noAccountTitle, body: DASHBOARD_COPY.noAccountBody },
  ambiguous: { title: DASHBOARD_COPY.ambiguousTitle, body: DASHBOARD_COPY.ambiguousBody },
} as const;

/**
 * A signed-in person the viewer cannot place on one account: none, or several with no default
 * (an addition to the locked screens). It names no account, so it has no rail.
 */
export function AccountStateScreen({ state }: { state: keyof typeof STATES }) {
  const s = STATES[state];
  return (
    <main data-v2-addition="" data-v2-account-state={state}>
      <Card as="section" className={shared.panel}>
        <h1 className={shared.title}>{s.title}</h1>
        <p className={shared.note}>{s.body}</p>
      </Card>
    </main>
  );
}
