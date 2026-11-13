import { Card, Heading } from '../../../../../../components/v2';
import { AccountShell } from '../../../../../../components/v2/AccountShell';
import { AccountSwitcher } from '../../../../../../components/v2/AccountSwitcher';
import styles from '../../../_preview/PreviewFrame.module.css';
import { switcherPreview } from '../../../_preview/accounts';
import { previewOnly } from '../../../_preview/guard';

/** An agency with a long name on the agency rail, the list open: a name wider than the rail wraps onto more lines. */
export default function AccountSwitcherLongPreview() {
  previewOnly();
  const shell = switcherPreview('long');
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
          An agency with a long name on the agency rail, the list open: a name wider than the rail
          wraps onto more lines.
        </p>
      </Card>
    </AccountShell>
  );
}
