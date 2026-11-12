/**
 * The words of the two pages a client report's recipient is sent to (CC-31 D8): the confirmation
 * link's and the pause link's. Each says what the button does before it is pressed; neither names
 * an address.
 */
export const RECIPIENT_COPY = {
  /** The sender, for an account that has no name. */
  someone: 'A Crawlmouse customer',
  confirm: {
    title: 'Confirm these reports',
    lines: (sender: string, host: string) => [
      `${sender} would like to send reports about ${host} to this address.`,
      'Nothing is sent until you confirm. Each report carries a link that stops them.',
    ],
    button: 'Confirm',
    done: 'Confirmed',
  },
  pause: {
    title: 'Stop these reports',
    lines: (sender: string, host: string) => [
      `${sender} sends reports about ${host} to this address.`,
      'The button stops them. They start again only if the sender turns them back on.',
    ],
    button: 'Stop the reports',
    done: 'Stopped',
  },
  gone: {
    title: 'This link can no longer be used',
    line: 'It was replaced by a newer one, or it has expired. The latest mail you were sent has the link that works.',
  },
} as const;
