/** Settings › Integrations: the page's sentences. */
export const INTEGRATIONS_COPY = {
  title: 'Integrations',
  line: 'Where Crawlmouse sends alerts, besides your email.',
  slackTitle: 'Slack',
  slackOff:
    'Send each alert to a Slack channel too. In Slack, create an incoming webhook for the channel, then paste its URL here.',
  slackOn: (last4: string) =>
    `Each alert also goes to the channel this webhook was made for. Its address ends in ${last4}, and we do not show the rest.`,
  slackLocked: 'Alerts to Slack are on Pro.',
  slackLockedNotOwner: 'Alerts to Slack are on Pro, and the account’s owner can change the plan.',
  slackStored: (last4: string) =>
    `A Slack webhook ending in ${last4} is still stored. Alerts do not post to it on Free, and will again if the account returns to a paid plan. Disconnect it to remove it.`,
  help: { label: 'How to create a webhook', href: 'https://api.slack.com/messaging/webhooks' },
  connect: 'Connect Slack',
  replace: 'Replace webhook',
  disconnect: 'Disconnect',
  test: 'Send a test message',
  seePlans: 'See plans',
  field: {
    label: 'Slack webhook URL',
    placeholder: 'https://hooks.slack.com/services/…',
  },
  connected: 'connected',
  notConnected: 'not connected',
  onPro: 'on Pro',
} as const;

/** What a test posts: fixed, so nothing of the account or its sites reaches Slack. */
export const SLACK_TEST_TEXT =
  'Crawlmouse test message: alerts for this account will post to this channel.';
