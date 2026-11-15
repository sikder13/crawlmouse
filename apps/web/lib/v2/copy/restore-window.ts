/**
 * The window a deletion's restore link has, in days (confirm_account_deletion's `purge_after`): its
 * one owner. `copy/deletion.ts` re-exports it as RESTORE_DAYS and `copy/settings.ts` as
 * DELETE_GRACE_DAYS; a module of its own so a test can give it another value and rebuild the
 * sentences that print it (`__tests__/v2/restore-window.test.tsx`).
 */
export const RESTORE_DAYS = 7;
