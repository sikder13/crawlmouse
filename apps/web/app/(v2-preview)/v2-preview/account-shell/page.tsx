import { Card, Heading } from '../../../../components/v2';
import { AccountFrame } from '../../../../components/v2/screens/account/AccountFrame';
import styles from '../_preview/PreviewFrame.module.css';
import { shellPreview } from '../_preview/accounts';
import { previewOnly } from '../_preview/guard';

/** The account frame, read from bad-site's account on day 9 of its Pro trial. */
export default function AccountShellPreview() {
  previewOnly();
  return (
    <AccountFrame shell={shellPreview('home')}>
      <Heading level={1} size="m">
        AccountShell
      </Heading>
      <Card className={styles.cardBody}>
        <p className={styles.note}>
          The rail every account screen sits in: the account&apos;s pages with their counts, the
          trial card and the theme row. On a phone the rail is a band across the top and the trial
          card is one line.
        </p>
      </Card>
    </AccountFrame>
  );
}
