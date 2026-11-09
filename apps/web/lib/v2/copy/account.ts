/**
 * The account frame's written sentences (the rail's trial card): the parts no record holds, every
 * number a parameter, so the view model fills it from the data (OPERATING-RULES §10).
 */
import { numberWord, plural } from '../words';

/** The Pro trial's length (FACTS: "one email … starts 14 days of Pro"). */
export const TRIAL_DAYS = 14;

export const ACCOUNT_COPY = {
  /** The first run: FACTS A6, short form. */
  trialFirstRun: (schedule: string) =>
    `When it ends, this site stays on Free with ${schedule} checks. Nothing you can see is deleted.`,
  /** After the first run: FACTS A6 and A8 (the reminder three days before). */
  trialLater: (host: string, schedule: string, others: number) =>
    `Then Free: ${host} keeps ${schedule} checks${
      others
        ? `; the other ${numberWord(others)} ${plural(others, 'site pauses', 'sites pause')} until you choose Pro or remove ${plural(others, 'it', 'them')}`
        : ''
    }. Nothing you can see is deleted. We'll email you three days before.`,
  noCard: 'No card on file.',
};
