import { Button } from '../../Button';
import { Heading } from '../../Heading';
import { PageShell } from '../../PageShell';
import { SUPPORT_COPY } from '../../../../lib/v2/copy/support';
import layout from '../../layout.module.css';
import styles from './ErrorScreen.module.css';

const COPY = SUPPORT_COPY.error;

export interface ErrorScreenProps {
  /** The Sentry event id of the error, once it is reported; null until then, or if it was not. */
  eventId: string | null;
  /** The support link (`supportMailto`). */
  support: string;
  onRetry: () => void;
}

/**
 * The signed-in area's error screen (CC-33 D5): what happened in one sentence, a retry, the support
 * link and the error's reference. No artboard exists: the account door's single column. Its footer
 * is left out, as on the door's pages, since a client screen cannot read the flags the footer's
 * links follow.
 */
export function ErrorScreen({ eventId, support, onRetry }: ErrorScreenProps) {
  return (
    <PageShell header="app" footer={false}>
      <main className={`${layout.wrap} ${styles.main}`}>
        <section className={styles.column}>
          <Heading level={1} size="m">
            {COPY.title}
          </Heading>
          <p className={styles.what}>{COPY.what}</p>
          <div className={`${layout.row} ${styles.actions}`}>
            <Button variant="primary" onClick={onRetry}>
              {COPY.retry}
            </Button>
            <a href={support} className={styles.support}>
              {COPY.support}
            </a>
          </div>
          {eventId ? <p className={styles.reference}>{COPY.reference(eventId)}</p> : null}
        </section>
      </main>
    </PageShell>
  );
}
