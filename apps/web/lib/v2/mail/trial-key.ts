/** The trial reminder's ledger key: one mail per account and trial end. */
export const trialReminderKey = (accountId: string, endsAt: Date): string =>
  `trial_reminder:${accountId}:${endsAt.toISOString()}`;
