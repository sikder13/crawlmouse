import { DELETE_COPY, deletionMoney, LINK_STATES, RESTORE_COPY } from '@/lib/v2/copy/deletion';
import { LINK_FLOWS } from '@/lib/v2/account/link-cookie';
import type { DeletionFlow, DeletionLinkView } from '@/lib/v2/account/deletion-link';
import { Button } from '../../Button';
import { Card } from '../../Card';
import { Heading } from '../../Heading';
import { PageShell } from '../../PageShell';
import layout from '../../layout.module.css';
import styles from '../check-email/Door.module.css';

const DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/**
 * The page a deletion's confirmation link or restore link opens (D4). It names the accounts the
 * button acts on and what happens; its form posts no field, so the token stays in its cookie and is
 * in no URL or HTML. With no usable link, or after the button was pressed, it says which.
 */
export function DeletionScreen({ flow, view }: { flow: DeletionFlow; view: DeletionLinkView }) {
  const copy = flow === 'deleteConfirm' ? DELETE_COPY : RESTORE_COPY;
  return (
    <PageShell header="app" footer={false}>
      <main className={`${layout.wrap} ${styles.main}`}>
        <section className={styles.column}>
          {view.ok ? (
            <>
              <Heading level={1} size="m">
                {copy.title}
              </Heading>
              <p className={styles.lead}>{copy.lead}</p>
              <Card className={styles.card}>
                <ul className={styles.cardBody}>
                  {view.accounts.map((a) => {
                    // What happens to this account's plan, by its state (`deletionMoney`); nothing
                    // for an account with no plan, or one that has ended.
                    const money = flow === 'deleteConfirm' ? deletionMoney(a.subscription) : null;
                    return (
                      <li key={a.id} data-account={a.id}>
                        <span className={styles.monoStrong}>{a.host}</span>
                        {money === null
                          ? null
                          : money.map((line) => (
                              <p key={line} className={styles.cardBody}>
                                {line}
                              </p>
                            ))}
                      </li>
                    );
                  })}
                </ul>
              </Card>
              {flow === 'deleteConfirm' ? (
                <>
                  {DELETE_COPY.what.map((line) => (
                    <p key={line} className={styles.cardBody}>
                      {line}
                    </p>
                  ))}
                </>
              ) : (
                <>
                  {view.purgeAfter ? (
                    <p className={styles.cardBody}>
                      {RESTORE_COPY.until(DATE.format(new Date(view.purgeAfter)))}
                    </p>
                  ) : null}
                  <p className={styles.cardBody}>{RESTORE_COPY.money}</p>
                </>
              )}
              <form method="post" action={LINK_FLOWS[flow].api} className={styles.actions}>
                <Button type="submit" variant="primary">
                  {copy.button}
                </Button>
              </form>
            </>
          ) : (
            <>
              <Heading level={1} size="m">
                {(LINK_STATES[view.code] ?? LINK_STATES.invalid_link!).title}
              </Heading>
              <p className={styles.lead}>
                {(LINK_STATES[view.code] ?? LINK_STATES.invalid_link!).body}
              </p>
            </>
          )}
        </section>
      </main>
    </PageShell>
  );
}
