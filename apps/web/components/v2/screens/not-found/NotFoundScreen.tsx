import { NOT_FOUND_COPY as COPY } from '@/lib/v2/copy/not-found';
import { AccountLink } from '../../AccountLink';
import { Button } from '../../Button';
import { Heading } from '../../Heading';
import { PageShell } from '../../PageShell';
import { MARKETING_NAV } from '../../footer-links';
import layout from '../../layout.module.css';
import styles from './NotFoundScreen.module.css';
import '@/styles/v2/tokens.css';

const OPEN_GATES = Object.freeze({ checksPublic: true });

/** The site's 404 in the v2 shell (RC-20, F-026): where you are, and three ways on. */
export function NotFoundScreen() {
  return (
    <PageShell
      nav={MARKETING_NAV}
      // Rendered in the browser, which cannot read the server's flags. The v2 404 is shown only
      // while V2_CHECKS_PUBLIC is on (app/not-found.tsx), so the gated links are open.
      footerGates={OPEN_GATES}
      actions={<AccountLink />}
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
