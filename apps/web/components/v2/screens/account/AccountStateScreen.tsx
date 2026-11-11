import { Heading } from '../../Heading';
import { PageShell } from '../../PageShell';
import layout from '../../layout.module.css';
import door from '../check-email/Door.module.css';
import { DASHBOARD_COPY } from '../../../../lib/v2/copy/dashboard';
import { SUPPORT_EMAIL } from '../../footer-links';

const STATES = {
  no_account: { title: DASHBOARD_COPY.noAccountTitle, body: DASHBOARD_COPY.noAccountBody },
  ambiguous: {
    title: DASHBOARD_COPY.ambiguousTitle,
    body: DASHBOARD_COPY.ambiguousBody(SUPPORT_EMAIL),
  },
} as const;

/**
 * A signed-in person the viewer cannot place on one account: none, or several with no default
 * (an addition to the locked screens). It names no account, so it has no rail: it wears the app
 * header with the brand, as the audit screens do, and no footer, as the account screens have none.
 * Its message is laid out as the door's message screens are (Continue, Check email): a centred
 * column with a heading and one line.
 */
export function AccountStateScreen({ state }: { state: keyof typeof STATES }) {
  const s = STATES[state];
  return (
    <PageShell header="app" footer={false}>
      <main
        className={`${layout.wrap} ${door.main}`}
        data-v2-addition=""
        data-v2-account-state={state}
      >
        <section className={door.column}>
          <Heading level={1} size="m">
            {s.title}
          </Heading>
          <p className={door.lead}>{s.body}</p>
        </section>
      </main>
    </PageShell>
  );
}
