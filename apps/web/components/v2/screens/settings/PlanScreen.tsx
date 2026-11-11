import type { SettingsView } from '../../../../lib/v2/view/settings';
import { AccountFrame } from '../account/AccountFrame';
import shared from '../account/AccountScreen.module.css';
import { PlanCard } from './PlanCard';

/**
 * Settings › Plan: the plan card alone, under the account's address and plan. It answers for an
 * account that holds no site, so billing stays reachable after every site is removed (spec 27).
 */
export function PlanScreen({ data }: { data: SettingsView }) {
  return (
    <AccountFrame shell={data.shell} currentIs="location">
      <header className={shared.header}>
        <div>
          <h1 className={shared.title}>{data.plan.title}</h1>
          <div className={shared.line}>{data.header.line}</div>
        </div>
      </header>
      <PlanCard plan={data.plan} columns={data.columns} />
    </AccountFrame>
  );
}
