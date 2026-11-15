/**
 * One PostHog person per human (CC-41 D1): the signed-in browser is identified as the user's
 * `users.id`, with the account axis and a few counts as person properties, and the visitor's first
 * touch set once.
 *
 * What is set. `$set` holds the keys of PERSON_SET_KEYS and nothing else: `identifyPerson` builds it
 * by reading those keys, so a key a caller adds (an email, a name) is not sent. `$set_once` holds the
 * `cm_ft` fields of FIRST_TOUCH_FIELDS, each prefixed `ft_`, built the same way.
 *
 * When. No call is made while capture is opted out: what posthog-js does with an identify then is
 * not documented, so the gate does not depend on it. A browser identified as another user is reset
 * first, so the two people are not merged.
 */
import type { AccountState } from '@crawlmouse/types/v2';
import { FIRST_TOUCH_FIELDS, type FirstTouch } from './first-touch';

export const PERSON_SET_KEYS = [
  'account_id',
  'plan',
  'internal',
  'checks_finished',
  'account_age_days',
  'trial_day',
] as const;

export interface PersonSet {
  /** The account the person is acting in. */
  account_id: string;
  /** The account's state: free, pro_trial, pro, agency_trial, agency or past_due. */
  plan: AccountState;
  internal: boolean;
  /** The account's finished and partial checks. */
  checks_finished: number;
  /** Whole days since the account's first state. */
  account_age_days: number;
  /** The day of the trial, 1 in its first 24 hours; null outside a trial. */
  trial_day: number | null;
}

export interface PersonTraits {
  userId: string;
  set: PersonSet;
}

/** The part of posthog-js this uses. */
export interface PersonPostHog {
  has_opted_out_capturing(): boolean;
  get_distinct_id(): string;
  get_property(name: string): unknown;
  reset(): void;
  identify(id: string, set: Record<string, unknown>, setOnce: Record<string, unknown>): void;
}

export function identifyPerson(
  ph: PersonPostHog,
  traits: PersonTraits,
  firstTouch: FirstTouch | null,
): void {
  if (ph.has_opted_out_capturing()) return;
  if (ph.get_property('$user_state') === 'identified' && ph.get_distinct_id() !== traits.userId) {
    ph.reset();
  }
  const set: Record<string, unknown> = {};
  for (const key of PERSON_SET_KEYS) set[key] = traits.set[key];
  const setOnce: Record<string, unknown> = {};
  for (const field of FIRST_TOUCH_FIELDS) {
    const value = firstTouch?.[field];
    if (value !== undefined) setOnce[`ft_${field}`] = value;
  }
  ph.identify(traits.userId, set, setOnce);
}

const DAY_MS = 86_400_000;
const TRIAL_STATES: ReadonlySet<AccountState> = new Set(['pro_trial', 'agency_trial']);

export interface TraitsSource {
  accountId: string;
  state: AccountState;
  /** Oldest first; the last entry is the current state (accounts.state_history). */
  stateHistory: readonly { state: AccountState; since: string }[];
  internal: boolean;
  checksFinished: number;
}

const wholeDays = (from: string, now: Date) =>
  Math.max(0, Math.floor((now.getTime() - new Date(from).getTime()) / DAY_MS));

export function personSet(source: TraitsSource, now: Date): PersonSet {
  const first = source.stateHistory[0];
  const current = source.stateHistory.at(-1);
  const inTrial = TRIAL_STATES.has(source.state) && current?.state === source.state;
  return {
    account_id: source.accountId,
    plan: source.state,
    internal: source.internal,
    checks_finished: source.checksFinished,
    account_age_days: first === undefined ? 0 : wholeDays(first.since, now),
    trial_day: inTrial ? wholeDays(current.since, now) + 1 : null,
  };
}
