/**
 * Confirmation mails of a client report schedule in any 24 hours: for one account, and to one
 * address, whichever account or site asks. The mailer keeps both, counted from its ledger
 * (`lib/v2/mail/handlers.ts`); each route that asks for the mail keeps the account's bound too, in
 * one shared bucket, so a press past it is answered at once.
 *
 * The routes that import this:
 *   grep -rln "CONFIRM_MAILS_PER_DAY" apps/web/app/api/report-files
 */
export const CONFIRM_MAILS_PER_DAY = { account: 20, address: 3 } as const;
