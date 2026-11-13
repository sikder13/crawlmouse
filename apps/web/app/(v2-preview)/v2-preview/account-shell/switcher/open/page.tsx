import { Card, Heading } from '../../../../../../components/v2';
import { AccountShell } from '../../../../../../components/v2/AccountShell';
import { AccountSwitcher } from '../../../../../../components/v2/AccountSwitcher';
import styles from '../../../_preview/PreviewFrame.module.css';
import { switcherPreview } from '../../../_preview/accounts';
import { previewOnly } from '../../../_preview/guard';

/** A person with three seats, the list open: each other account is a button that switches to it. */
export default function AccountSwitcherOpenPreview() {
  previewOnly();
  const shell = switcherPreview('three');
  return (
    <AccountShell
      nav={shell.nav}
      badge={shell.badge}
      account={<AccountSwitcher switcher={shell.switcher!} defaultOpen />}
    >
      <Heading level={1} size="m">
        AccountSwitcher
      </Heading>
      <Card className={styles.cardBody}>
        <p className={styles.note}>
          A person with three seats, the list open: each other account is a button that switches to
          it.
        </p>
      </Card>
    </AccountShell>
  );
}
