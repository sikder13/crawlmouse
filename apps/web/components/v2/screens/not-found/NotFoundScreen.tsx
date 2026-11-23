import { NOT_FOUND_COPY as COPY } from '@/lib/v2/copy/not-found';
import { Button } from '../../Button';
import { Heading } from '../../Heading';
import { PageShell } from '../../PageShell';
import { LOG_IN, MARKETING_NAV } from '../../footer-links';
import layout from '../../layout.module.css';
import styles from './NotFoundScreen.module.css';

/** The site's 404 in the v2 shell (RC-20, F-026): where you are, and three ways on. */
export function NotFoundScreen() {
  return (
    <PageShell
      nav={MARKETING_NAV}
      actions={
        <Button variant="quiet" href={LOG_IN.href}>
          {LOG_IN.label}
        </Button>
      }
    >
      <main className={`${layout.wrap} ${styles.main}`}>
        <p className={styles.code}>404</p>
        <Heading level={1} size="xl">
          {COPY.title}
        </Heading>
        <p className={styles.lead}>{COPY.lead}</p>
        <div className={`${layout.row} ${styles.actions}`}>
          <Button variant="primary" size="lg" href={COPY.primary.href}>
            {COPY.primary.label}
          </Button>
          {COPY.links.map((l) => (
            <Button key={l.href} variant="quiet" size="lg" href={l.href}>
              {l.label}
            </Button>
          ))}
        </div>
      </main>
    </PageShell>
  );
}
