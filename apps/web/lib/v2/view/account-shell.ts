/**
 * The account frame as data: the rail's links with their counts, the trial card and the seat's
 * theme. Every account screen reads it (the dashboard and site page here, CC-27's screens next), so
 * the counts and the trial's dates cannot differ from one screen to the next.
 */
import { instant, type Change, type Site } from '@crawlmouse/types/v2';
import { TRIAL_REMINDER_DAYS_BEFORE_END } from '../../auth/constants';
import { AGENCY_MONTHLY, PRO_MONTHLY } from '../../billing/prices';
import { GATES, type Tier } from '../../entitlement-v2';
import { ACCOUNT_COPY as COPY } from '../copy/account';
import { calendarDays, dayDate, daysBefore, hourMinute } from '../format';
import { plural } from '../words';
import { PLAN_NAMES, primarySite, primarySites, resultChecks, type AccountView } from './account';
import { ACCOUNT_NAV, action, type ActionView } from './account-actions';

export interface NavItemView {
  label: string;
  href: string;
  /** "5", "3 new"; null when there is nothing to count. */
  count: string | null;
  current: boolean;
  /** The count names new changes. */
  fresh: boolean;
}

export interface TrialCardView {
  /** "Pro, trial · ends Sat 7 Nov". */
  title: string;
  /** "8 days left", in calendar days of the account's zone (Q4). */
  left: string;
  /** "No card on file. When it ends, …" on the first run; "Then Free: …" after it. */
  note: string;
  /** On the first run: a link to billing. */
  billing: ActionView | null;
  /** After the first run: keeping the plan, at its price. */
  keep: ActionView | null;
}

export interface ShellView {
  nav: NavItemView[];
  trial: TrialCardView | null;
  /** The signed-in seat's theme. */
  theme: 'system' | 'light' | 'dark';
  /** Where a new theme is saved (PATCH /api/me {theme}). */
  themeAction: ActionView;
}

/** Free re-checks monthly (GATES.free.schedule), in the word the trial card uses. */
export const FREE_SCHEDULE = { monthly_first_site_only: 'monthly', weekly: 'weekly' } as const;

/**
 * A site's changes since its previous check: those found at its latest result that compare with an
 * earlier check (Q5). A first audit's findings carry no previous check, so they are not changes.
 */
export function siteWindow(v: AccountView, site: Site): Change[] {
  const check = resultChecks(v, site.id).at(-1);
  if (!check) return [];
  return v.d.changes
    .filter((c) => c.check_id === check.id && c.previous_check_id !== null)
    .sort((a, b) => instant(a.detected_at) - instant(b.detected_at) || a.id.localeCompare(b.id));
}

/** The changes the rail calls new: opened and resolved, across every site's window. */
export const newChanges = (v: AccountView): Change[] =>
  v.d.sites.flatMap((s) =>
    siteWindow(v, s).filter((c) => c.kind === 'opened' || c.kind === 'resolved'),
  );

/** No site has two results yet, so there is nothing to compare: the day-0 layout. */
export const isFirstRun = (v: AccountView) =>
  v.d.sites.every((s) => resultChecks(v, s.id).length <= 1);

/**
 * Where the plan's terms and its Keep action are read: in the rail's trial card (the default),
 * or on the page itself (the Trial-ending screen), which leaves the card its dates and what the
 * card on file means.
 */
export type PlanPlace = 'rail' | 'page';

function trialCard(
  v: AccountView,
  plan: PlanPlace,
  billingEnd: string | null,
): TrialCardView | null {
  const a = v.account;
  if (a.state !== 'pro_trial' && a.state !== 'agency_trial') return null;
  const zone = a.timezone;
  const end = a.trial_ends_at!;
  const days = calendarDays(v.now, end, zone);
  const tier: Tier = a.state === 'pro_trial' ? 'pro' : 'agency';
  const freeSchedule = FREE_SCHEDULE[GATES.free.schedule];
  const price = tier === 'pro' ? PRO_MONTHLY : AGENCY_MONTHLY;
  const title = `${PLAN_NAMES[tier]}, trial · ends ${dayDate(end, zone)}`;
  const left =
    days <= 0
      ? `ends today at ${hourMinute(end, zone)}`
      : `${days} ${plural(days, 'day', 'days')} left`;
  if (plan === 'page') {
    return {
      title,
      left,
      note:
        a.card_last4 === null
          ? `${COPY.noCard} ${COPY.nothingCharged}`
          : billingEnd !== null
            ? COPY.cardNotCharged(a.card_last4, dayDate(end, zone))
            : COPY.cardCharged(a.card_last4, dayDate(end, zone)),
      billing: null,
      keep: null,
    };
  }
  const reminderDue =
    instant(daysBefore(end, TRIAL_REMINDER_DAYS_BEFORE_END, zone)) <= instant(v.now);
  const firstRun = isFirstRun(v);
  return {
    title,
    left,
    note: firstRun
      ? `${a.card_last4 === null ? `${COPY.noCard} ` : ''}${COPY.trialFirstRun(freeSchedule)}`
      : COPY.trialLater(
          primarySite(v).host,
          freeSchedule,
          primarySites(v).length - 1,
          reminderDue ? null : TRIAL_REMINDER_DAYS_BEFORE_END,
        ),
    billing: firstRun ? action('plan', 'Billing') : null,
    keep: firstRun
      ? null
      : action(
          'keepPlan',
          `Keep ${PLAN_NAMES[tier]}, $${price} a month`,
          {},
          { fields: { plan: tier, interval: 'month' } },
        ),
  };
}

/**
 * The frame for one account screen; `current` names the rail link it is, or null on a page that is
 * none of them. `plan: 'page'` is for a page that carries the plan's terms and Keep action itself.
 */
export function accountShellView(
  v: AccountView,
  current: (typeof ACCOUNT_NAV)[number]['label'] | null,
  {
    plan = 'rail',
    billingEnd = null,
  }: {
    plan?: PlanPlace;
    /** A subscription set to cancel at its period's end: a card trial's card is then not charged. */
    billingEnd?: string | null;
  } = {},
): ShellView {
  const fresh = newChanges(v).length;
  const seat = v.d.seats.find((s) => s.role === 'owner');
  return {
    nav: ACCOUNT_NAV.map((n) => ({
      ...n,
      count:
        n.label === 'Sites'
          ? String(v.d.sites.length)
          : n.label === 'Changes' && fresh
            ? `${fresh} new`
            : null,
      current: n.label === current,
      fresh: n.label === 'Changes' && fresh > 0,
    })),
    trial: trialCard(v, plan, billingEnd),
    theme: seat?.theme ?? 'system',
    themeAction: action('theme', 'Theme'),
  };
}
