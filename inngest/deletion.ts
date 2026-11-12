/**
 * The three functions of an account deletion (CC-27b D4), registered only with V2_CHECKS_PUBLIC=1
 * (apps/web/lib/v2/pipeline/functions.ts). What each step does is injected, so this package imports
 * nothing from the app; the steps are apps/web/lib/v2/account/deletion-purge.ts.
 *
 * - deletionCancelFn, on `account.deletion_confirmed` (one per marked account): ends the account's
 *   subscription through CC-03's cancel, recording first whether this deletion set it to end. A
 *   restore that came first leaves nothing to cancel (the step reads the queue row under its lock).
 * - deletionResumeFn, on `account.restored`: continues the subscriptions the deletion set to end.
 * - purgeDeletedAccountsFn, daily: erases each person whose seven days have passed.
 *
 * The cancel and the resume of one person run one at a time (a shared concurrency key), each in a
 * single step, so a resume cannot be overtaken by the cancel it undoes.
 */
import { NonRetriableError } from 'inngest';
import { inngest } from './client';

export const DELETION_CANCEL_FN_ID = 'crawlmouse.account.deletion-cancel';
export const DELETION_RESUME_FN_ID = 'crawlmouse.account.deletion-resume';
export const PURGE_DELETED_ACCOUNTS_FN_ID = 'crawlmouse.account.purge-deleted';

/** The most people one purge run erases: one step each, well inside Inngest's steps per run. */
export const PURGE_LIMIT = 50;

/** One person's deletion functions, one at a time, across the cancel and the resume. */
const PER_PERSON: [{ scope: 'env'; key: string; limit: number }] = [
  { scope: 'env', key: '"account-deletion:" + event.data.userId', limit: 1 },
];

export interface DeletionBilling {
  /** Ends the account's subscription for the person's deletion; what happened, for the run's output. */
  cancel(userId: string, accountId: string): Promise<string>;
  /** Continues a subscription the deletion set to end; what happened. */
  resume(subscriptionId: string): Promise<string>;
}

export interface DuePerson {
  userId: string;
  accounts: string[];
}

export interface PurgeOutcome {
  outcome: 'purged' | 'refused';
  /** Rows deleted or changed by `table.action` when purged; the refusals when refused. */
  counts?: Record<string, number>;
  refusals?: string[];
}

export interface Purge {
  /** The time now, in ms since the epoch. */
  now(): number;
  /** The people whose window ended by `at`, at most `limit`, with the accounts their confirm marked. */
  due(at: Date, limit: number): Promise<DuePerson[]>;
  /**
   * Erases one person, or says why it cannot yet (counting the attempt and reporting it). Throws on a
   * failure, which Inngest retries.
   */
  purgeOne(person: DuePerson): Promise<PurgeOutcome>;
  /** Counts a purge of the person that did not finish, and reports it (user id only). */
  failed(userId: string, why: string): Promise<void>;
}

export function createDeletionCancelFn(billing: () => DeletionBilling) {
  return inngest.createFunction(
    {
      id: DELETION_CANCEL_FN_ID,
      concurrency: PER_PERSON,
      cancelOn: [{ event: 'account.restored', match: 'data.userId' }],
    },
    { event: 'account.deletion_confirmed' },
    async ({ event, step }) => {
      const { userId, accountId } = event.data;
      return step.run('cancel', () => billing().cancel(userId, accountId));
    },
  );
}

export function createDeletionResumeFn(billing: () => DeletionBilling) {
  return inngest.createFunction(
    { id: DELETION_RESUME_FN_ID, concurrency: PER_PERSON },
    { event: 'account.restored' },
    async ({ event, step }) => {
      const done: string[] = [];
      for (const id of event.data.subscriptionIds) {
        done.push(await step.run(`resume-${id}`, () => billing().resume(id)));
      }
      return done;
    },
  );
}

export function createPurgeDeletedAccountsFn(purge: () => Purge) {
  return inngest.createFunction(
    { id: PURGE_DELETED_ACCOUNTS_FN_ID, concurrency: { limit: 1 } },
    { cron: '30 3 * * *' },
    async ({ step }) => {
      const at = new Date(await step.run('now', async () => new Date(purge().now()).toISOString()));
      const due = await step.run('due', () => purge().due(at, PURGE_LIMIT));

      const purged: string[] = [];
      const refused: string[] = [];
      const failed: string[] = [];
      for (const person of due) {
        const { userId } = person;
        try {
          const r = await step.run(`purge-${userId}`, () => purge().purgeOne(person));
          (r.outcome === 'purged' ? purged : refused).push(userId);
        } catch (error) {
          failed.push(userId);
          await step.run(`failed-${userId}`, () =>
            purge().failed(userId, error instanceof Error ? error.message : String(error)),
          );
        }
      }
      if (failed.length > 0) {
        throw new NonRetriableError(
          `purge: ${failed.length} of ${due.length} people failed: ${failed.join(', ')}`,
        );
      }
      return { due: due.length, purged: purged.length, refused: refused.length };
    },
  );
}
