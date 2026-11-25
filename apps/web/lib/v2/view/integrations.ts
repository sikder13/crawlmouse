/**
 * Settings › Integrations as data: one card per connection the account can make. Slack is the one
 * there is today; the page takes further cards without changing shape. `slackLast4` is what
 * `account_slack_last4` answers, null when none is set; the URL itself is never read here.
 */
import type { SeatRole } from '../account/profile';
import { INTEGRATIONS_COPY as COPY } from '../copy/integrations';
import { viewAt, type AccountDataset, type Viewer } from './account';
import { action, type ActionInput, type ActionView } from './account-actions';
import { accountShellView, type ShellView } from './account-shell';
import { routeAction } from './settings';

export interface IntegrationCardView {
  key: 'slack';
  title: string;
  body: string;
  status: { state: 'ok' | 'neutral'; label: string };
  /** The form that sets or replaces the connection; null where the tier has none. */
  connect: ActionView | null;
  disconnect: ActionView | null;
  /** Posts a fixed test message to the connected webhook. */
  test: ActionView | null;
  /** The way to a plan that has it: for the owner, who alone may change the plan. */
  upgrade: ActionView | null;
  help: { label: string; href: string } | null;
}

export interface IntegrationsView {
  shell: ShellView;
  title: string;
  line: string;
  cards: IntegrationCardView[];
}

const WEBHOOK_FIELD: ActionInput = {
  kind: 'text',
  name: 'slackWebhookUrl',
  type: 'url',
  ...COPY.field,
  required: true,
  autoComplete: 'off',
};

const disconnect = (): ActionView =>
  routeAction('accountAlertRules', COPY.disconnect, {}, { fields: { clearSlack: 'true' } });

function slackCard(entitled: boolean, last4: string | null, role: SeatRole): IntegrationCardView {
  const base = { key: 'slack' as const, title: COPY.slackTitle };
  if (!entitled) {
    const owner = role === 'owner';
    // A destination kept from a trial: alerts do not post to it on this tier, and will again on
    // a paid one, so the page says so and offers to remove it.
    const locked = owner ? COPY.slackLocked : COPY.slackLockedNotOwner;
    return {
      ...base,
      body: last4 === null ? locked : `${COPY.slackStored(last4)} ${locked}`,
      status: { state: 'neutral', label: COPY.onPro },
      connect: null,
      disconnect: last4 === null ? null : disconnect(),
      test: null,
      upgrade: owner ? action('plan', COPY.seePlans) : null,
      help: null,
    };
  }
  const form = (label: string): ActionView => ({
    ...routeAction('accountAlertRules', label),
    inputs: [WEBHOOK_FIELD],
  });
  if (last4 === null) {
    return {
      ...base,
      body: COPY.slackOff,
      status: { state: 'neutral', label: COPY.notConnected },
      connect: form(COPY.connect),
      disconnect: null,
      test: null,
      upgrade: null,
      help: COPY.help,
    };
  }
  return {
    ...base,
    body: COPY.slackOn(last4),
    status: { state: 'ok', label: COPY.connected },
    connect: form(COPY.replace),
    disconnect: disconnect(),
    test: routeAction('accountAlertRules', COPY.test, {}, { fields: { testSlack: 'true' } }),
    upgrade: null,
    help: COPY.help,
  };
}

/** `role` is the reader's, as the page's own `member_role` read it: the rail and the plan link follow it. */
export function integrationsView(
  d: AccountDataset,
  viewer: Viewer,
  slackLast4: string | null,
  role: SeatRole,
): IntegrationsView {
  const v = viewAt(d, viewer);
  return {
    shell: accountShellView(v, 'Integrations', { role }),
    title: COPY.title,
    line: COPY.line,
    cards: [slackCard(v.gates.slack, slackLast4, role)],
  };
}

/**
 * The dataset with the account's Slack destination as its one integration, when one is set. No
 * table records a connection (`account/rows.ts` leaves the list empty): the destination is read
 * from `account_slack_last4`, and only whether it is set goes into the view.
 */
export function withSlackConnected(
  d: AccountDataset,
  accountId: string,
  set: boolean,
): AccountDataset {
  if (!set) return d;
  return {
    ...d,
    accounts: d.accounts.map((a) =>
      a.id === accountId
        ? { ...a, integrations: [{ kind: 'slack', connected: true, label: null }] }
        : a,
    ),
  };
}
