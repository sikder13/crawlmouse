import '../../../styles/v2/tokens.css';
import type { ReactNode } from 'react';
import { Button } from '@/components/v2/Button';
import { PageShell } from '@/components/v2/PageShell';
import { LOG_IN, MARKETING_NAV } from '@/components/v2/footer-links';
import { LegalPage } from '@/components/legal/LegalPage';
import { withoutV1Chrome } from './v1-chrome';
import styles from './LegalShell.module.css';

/**
 * A legal page on the v2 design (RC-08). The words are the v1 page's own output, unchanged: legal
 * text changes only with the owner's sign-off, so this restyles it and rewrites nothing.
 */
export function legalPage(page: ReactNode) {
  return (
    <div className={styles.frame} data-v2-legal-frame="">
      <PageShell
        nav={MARKETING_NAV}
        actions={
          <Button variant="quiet" href={LOG_IN.href}>
            {LOG_IN.label}
          </Button>
        }
      >
        <div className={styles.legal} data-v2-legal="" data-v1-content="">
          {withoutV1Chrome(page, [LegalPage])}
        </div>
      </PageShell>
    </div>
  );
}
