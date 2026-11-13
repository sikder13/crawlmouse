/**
 * The words of the pages a client report's recipient is sent to (CC-31 D8): the confirmation
 * link's, the pause link's and "Don't ask me again". Each says what the button does before it is
 * pressed; none names an address.
 */
export const RECIPIENT_COPY = {
  /** The sender, for an account that has no name. */
  someone: 'A Crawlmouse customer',
  /** On the confirmation mail, the confirmation page and the pause page (owner ruling, Q42). */
  forGood: 'You can stop these requests for good with one click.',
  declineButton: 'Don’t ask me again',
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
      'The button stops them. The sender cannot start them again: they start only if you are asked to confirm again and do, and you are asked once.',
    ],
    button: 'Stop the reports',
    done: 'Stopped',
  },
  decline: {
    title: 'Stop these requests',
    lines: (sender: string, host: string) => [
      `${sender} asked to send reports about ${host} to this address.`,
      'The button stops the requests for good: you are not asked again about this site, and no report about it is sent to this address.',
    ],
    /** For a link whose mail is too old to say who asked. */
    plain: [
      'The button stops the requests for good: you are not asked again about this site, and no report about it is sent to this address.',
    ],
    button: 'Don’t ask me again',
    done: 'You will not be asked again',
  },
  gone: {
    title: 'This link can no longer be used',
    line: 'It was replaced by a newer one, or it has expired. The latest mail you were sent has the link that works.',
  },
} as const;
