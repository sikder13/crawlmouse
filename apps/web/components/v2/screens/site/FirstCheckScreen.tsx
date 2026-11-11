import { Card } from '../../Card';
import type { FirstCheckView } from '../../../../lib/v2/view/site';
import { AccountFrame } from '../account/AccountFrame';
import { ActionControl } from '../account/ActionControl';
import { Notice, type NoticeView } from '../account/Notice';
import shared from '../account/AccountScreen.module.css';

/** A site page before the site's first check ends with a result (an addition to Final-Site). */
export function FirstCheckScreen({
  data,
  notice,
}: {
  data: FirstCheckView;
  /** A refused form's notice, on a live page. */
  notice?: NoticeView | null;
}) {
  return (
    <AccountFrame shell={data.shell} currentIs="location">
      <header className={shared.header} data-v2-addition="" data-v2-first-check={data.state}>
        <div>
          <h1 className={shared.title}>{data.title}</h1>
          <div className={shared.line}>{data.line}</div>
        </div>
        <div className={shared.actions}>
          {data.actions.map((a) => (
            <ActionControl key={a.label} action={a} size="md" />
          ))}
        </div>
      </header>
      <Notice notice={notice} />
      <Card as="section" className={shared.panel}>
        <div className={shared.note}>{data.body}</div>
      </Card>
    </AccountFrame>
  );
}
