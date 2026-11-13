/**
 * Confirmation mails of a client report schedule in any 24 hours: for one account, and to one
 * address, whichever account or site asks. The mailer keeps both, counted from its ledger
 * (`lib/v2/mail/handlers.ts`); each route that asks for the mail keeps the account's bound too, in
 * one shared bucket, so a press past it is answered at once.
 *
 * The routes that import this:
 *   grep -rln --include=route.ts "CONFIRM_MAILS_PER_DAY" apps/web/app/api/report-files
 */
export const CONFIRM_MAILS_PER_DAY = { account: 20, address: 3 } as const;

/**
 * Days in which a recipient who paused is asked to confirm again at most once: SQL's
 * `report_reask_window()`, said by the pages and the notices. A test holds the two equal:
 *   pnpm --filter @crawlmouse/web exec vitest run __tests__/v2-031-b2-schedules.test.ts -t "the window is thirty days"
 */
export const REASK_WINDOW_DAYS = 30;
