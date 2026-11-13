/**
 * The words of in-product support (CC-33 D5): the support email's fixed subject and prompt, the
 * error screen, and the links on Settings and the fix page. The ids the email carries are added by
 * `supportMailto` (lib/v2/support/mailto.ts); nothing here holds an address or an id.
 */
export const SUPPORT_COPY = {
  mail: {
    subject: {
      general: 'Crawlmouse support',
      error: 'Crawlmouse: a page showed an error',
      fix: 'Crawlmouse: something is wrong with a fix',
    },
    /** The line after the ids, where the reader starts writing. */
    prompt: {
      general: 'Your question:',
      error: 'What were you doing when it happened?',
      fix: 'What is wrong with this fix?',
    },
  },
  error: {
    title: 'This page stopped with an error',
    /** What happened, in one sentence. */
    what: 'Something went wrong while the page was loading, and the error was reported to us.',
    retry: 'Try again',
    support: 'Email support',
    reference: (eventId: string) => `Reference: ${eventId}`,
  },
  settings: { lead: 'A question about this account?', link: 'Email support' },
  fix: { lead: 'Something wrong with this fix?', link: 'Tell us' },
} as const;
