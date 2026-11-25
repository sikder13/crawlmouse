import { Card } from '../../Card';
import type { SettingsNotYoursView } from '../../../../lib/v2/view/settings';
import { AccountFrame } from '../account/AccountFrame';
import shared from '../account/AccountScreen.module.css';

/**
 * Settings for a seat that may not change them (D-03): the rail, so the seat stays in its account,
 * and one line on who changes them. No form: nothing here posts.
 */
export function SettingsNotYoursScreen({ data }: { data: SettingsNotYoursView }) {
  return (
    <AccountFrame shell={data.shell}>
      <header className={shared.header}>
        <div>
          <h1 className={shared.title}>{data.header.title}</h1>
          <div className={shared.line}>{data.header.line}</div>
        </div>
      </header>
      <Card as="section" className={shared.panel}>
        <p data-v2-addition="">{data.text}</p>
      </Card>
    </AccountFrame>
  );
}
