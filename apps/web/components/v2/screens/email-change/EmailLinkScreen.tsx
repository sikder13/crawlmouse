import type { EmailLinkFlow, EmailLinkView } from '@/lib/v2/account/email-change-page';
import { LINK_FLOWS } from '@/lib/v2/account/link-cookie';
import { EMAIL_CHANGE_COPY } from '@/lib/v2/copy/email-change';
import { Button } from '../../Button';
import { Heading } from '../../Heading';
import { PageShell } from '../../PageShell';
import layout from '../../layout.module.css';
import styles from '../check-email/Door.module.css';

/**
 * The page an email-change link lands on (CC-27b D3), in the account door's single column. A live
 * link shows what the button does and a form that posts no field to the flow's API route; the token
 * is in an HttpOnly cookie, and nothing here holds it. No script: the form posts and the route
 * redirects back here with the answer.
 */
export function EmailLinkScreen({ flow, view }: { flow: EmailLinkFlow; view: EmailLinkView }) {
  const copy = EMAIL_CHANGE_COPY[flow];
  return (
    <PageShell header="app" footer={false}>
      <main className={`${layout.wrap} ${styles.main}`}>
        <section className={styles.column}>
          {view.state === 'ready' ? (
            <>
              <Heading level={1} size="m">
                {copy.ready.heading}
              </Heading>
              <p className={styles.lead}>{copy.ready.lead(view.address)}</p>
              <form method="post" action={LINK_FLOWS[flow].api} className={styles.actions}>
                <Button type="submit" variant="primary">
                  {copy.ready.button}
                </Button>
              </form>
            </>
          ) : view.state === 'done' ? (
            <>
              <Heading level={1} size="m">
                {copy.done.heading}
              </Heading>
              <p className={styles.lead}>{copy.done.lead}</p>
            </>
          ) : view.state === 'refused' ? (
            <>
              <Heading level={1} size="m">
                {copy.title}
              </Heading>
              <p className={styles.lead} role="alert">
                {copy.refused[view.code]}
              </p>
            </>
          ) : (
            <>
              <Heading level={1} size="m">
                {copy.unusable.heading}
              </Heading>
              <p className={styles.lead}>{copy.unusable.lead}</p>
            </>
          )}
        </section>
      </main>
    </PageShell>
  );
}
