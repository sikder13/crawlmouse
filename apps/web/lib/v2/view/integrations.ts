/**
 * Settings › Integrations as data: the account's Slack destination. `slackLast4` is what
 * `account_slack_last4` answers, null when none is set; the URL itself is never read here.
 */
import { INTEGRATIONS_COPY as COPY } from '../copy/integrations';
import { readerRole, viewAt, type AccountDataset, type Viewer } from './account';
import { action, type ActionInput, type ActionView } from './account-actions';
import { accountShellView, type ShellView } from './account-shell';
import { routeAction } from './settings';

export interface SlackCardView {
  title: string;
  body: string;
  status: { state: 'ok' | 'neutral'; label: string };
  /** The form that sets or replaces the webhook; null on a tier without Slack. */
  connect: ActionView | null;
  disconnect: ActionView | null;
  /** The way to a plan with Slack, on a tier without it. */
  upgrade: ActionView | null;
  help: { label: string; href: string } | null;
}

export interface IntegrationsView {
  shell: ShellView;
  title: string;
  line: string;
  slack: SlackCardView;
}

const WEBHOOK_FIELD: ActionInput = {
  kind: 'text',
  name: 'slackWebhookUrl',
  type: 'url',
  ...COPY.field,
  required: true,
  autoComplete: 'off',
};

function slackCard(entitled: boolean, last4: string | null): SlackCardView {
  const title = COPY.slackTitle;
  if (!entitled) {
    return {
      title,
      body: COPY.slackLocked,
      status: { state: 'neutral', label: COPY.onPro },
      connect: null,
      disconnect: null,
      upgrade: action('plan', COPY.seePlans),
      help: null,
    };
  }
  const form = (label: string): ActionView => ({
    ...routeAction('accountAlertRules', label),
    inputs: [WEBHOOK_FIELD],
  });
  if (last4 === null) {
    return {
      title,
      body: COPY.slackOff,
      status: { state: 'neutral', label: COPY.notConnected },
      connect: form(COPY.connect),
      disconnect: null,
      upgrade: null,
      help: COPY.help,
    };
  }
  return {
    title,
    body: COPY.slackOn(last4),
    status: { state: 'ok', label: COPY.connected },
    connect: form(COPY.replace),
    disconnect: routeAction(
      'accountAlertRules',
      COPY.disconnect,
      {},
      {
        fields: { clearSlack: 'true' },
      },
    ),
    upgrade: null,
    help: COPY.help,
  };
}

export function integrationsView(
  d: AccountDataset,
  viewer: Viewer,
  slackLast4: string | null,
): IntegrationsView {
  const v = viewAt(d, viewer);
  return {
    shell: accountShellView(v, 'Integrations', { role: readerRole(v) ?? 'developer' }),
    title: COPY.title,
    line: COPY.line,
    slack: slackCard(v.gates.slack, slackLast4),
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
