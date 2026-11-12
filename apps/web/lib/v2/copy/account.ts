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
  /**
   * After the first run: FACTS A6, and A8 while the reminder is still ahead (`reminderDays` before
   * the end); once it is due the sentence about it is left out, since it would no longer be true.
   */
  trialLater: (host: string, schedule: string, others: number, reminderDays: number | null) =>
    `Then Free: ${host} keeps ${schedule} checks${
      others
        ? `; the other ${numberWord(others)} ${plural(others, 'site pauses', 'sites pause')} until you choose Pro or remove ${plural(others, 'it', 'them')}`
        : ''
    }. Nothing you can see is deleted.${
      reminderDays === null ? '' : ` We'll email you ${numberWord(reminderDays)} days before.`
    }`,
  noCard: 'No card on file.',
  /** Where the page carries the plan (the Trial-ending screen), the card says only what the card on file means. */
  nothingCharged: 'Nothing is charged unless you choose Pro.',
  cardNotCharged: (last4: string, date: string) =>
    `The trial ends on ${date} and the card ending ${last4} is not charged.`,
  cardCharged: (last4: string, date: string) =>
    `The card ending ${last4} is charged on ${date} unless you cancel.`,
};
