import { Button, Heading, PageShell } from '../../../../components/v2';
import styles from '../_preview/PreviewFrame.module.css';
import { previewOnly } from '../_preview/guard';

export default function PageShellPreview() {
  previewOnly();
  return (
    <PageShell
      nav={[
        { label: 'Product', href: '#' },
        { label: 'For agencies', href: '#' },
        { label: 'Developers', href: '#' },
        { label: 'Pricing', href: '#' },
      ]}
      actions={
        <Button variant="quiet" href="#">
          Log in
        </Button>
      }
    >
      <main className={styles.main}>
        <Heading level={1} size="m">
          PageShell
        </Heading>
        <p className={styles.note}>
          The marketing header with the mark, the wordmark and the primary navigation, and the
          footer. The app header is the frame of every other preview page.
        </p>
      </main>
    </PageShell>
  );
}
