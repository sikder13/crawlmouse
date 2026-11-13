import { Card, Heading } from '../../../../../components/v2';
import { AccountShell } from '../../../../../components/v2/AccountShell';
import { AccountSwitcher } from '../../../../../components/v2/AccountSwitcher';
import styles from '../../_preview/PreviewFrame.module.css';
import { switcherPreview } from '../../_preview/accounts';
import { previewOnly } from '../../_preview/guard';

/** A person with two seats, as a page opens: the account acted in, and the list of the other closed. */
export default function AccountSwitcherPreview() {
  previewOnly();
  const shell = switcherPreview('two');
  return (
    <AccountShell
      nav={shell.nav}
      badge={shell.badge}
      account={<AccountSwitcher switcher={shell.switcher!} />}
    >
      <Heading level={1} size="m">
        AccountSwitcher
      </Heading>
      <Card className={styles.cardBody}>
        <p className={styles.note}>
          A person with two seats, as a page opens: the account acted in, and the list of the other
          closed.
        </p>
      </Card>
    </AccountShell>
  );
}
