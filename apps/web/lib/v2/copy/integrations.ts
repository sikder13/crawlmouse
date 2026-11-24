/** Settings › Integrations: the page's sentences. */
export const INTEGRATIONS_COPY = {
  title: 'Integrations',
  line: 'Where Crawlmouse sends alerts, besides your email.',
  slackTitle: 'Slack',
  slackOff:
    'Post each alert to a Slack channel. In Slack, create an incoming webhook for the channel, then paste its URL here.',
  slackOn: (last4: string) =>
    `Alerts post to the channel this webhook was made for. Its address ends in ${last4}, and we do not show the rest.`,
  slackLocked: 'Alerts to Slack are on Pro.',
  help: { label: 'How to create a webhook', href: 'https://api.slack.com/messaging/webhooks' },
  connect: 'Connect Slack',
  replace: 'Replace webhook',
  disconnect: 'Disconnect',
  seePlans: 'See plans',
  field: {
    label: 'Slack webhook URL',
    placeholder: 'https://hooks.slack.com/services/…',
  },
  connected: 'connected',
  notConnected: 'not connected',
  onPro: 'on Pro',
} as const;
