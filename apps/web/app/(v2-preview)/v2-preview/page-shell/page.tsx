import { Button, Heading, LOG_IN, MARKETING_NAV, PageShell } from '../../../../components/v2';
import styles from '../_preview/PreviewFrame.module.css';
import { previewOnly } from '../_preview/guard';

export default function PageShellPreview() {
  previewOnly();
  return (
    <PageShell
      nav={MARKETING_NAV}
      status="ok"
      actions={
        <Button variant="quiet" href={LOG_IN.href}>
          {LOG_IN.label}
        </Button>
      }
    >
      <main className={styles.main}>
        <Heading level={1} size="m">
          PageShell
        </Heading>
        <p className={styles.note}>
          The marketing header with the mark, the wordmark and the primary navigation with its Learn
          menu, and the footer, here with its status set to ok. The app header is the frame of every
          other preview page.
        </p>
      </main>
    </PageShell>
  );
}
