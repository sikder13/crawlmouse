/**
 * The account frame as data: the rail's links with their counts, the trial card and the seat's
 * theme. Every account screen reads it (the dashboard and site page here, CC-27's screens next), so
 * the counts and the trial's dates cannot differ from one screen to the next.
 *
 * CC-31 adds three things. An account on the Agency tier gets the agency rail (`AGENCY_NAV`), its
 * badge and, outside a trial, its plan card. A person with seats on several accounts gets the
 * switcher: the account acted in and the others, each a POST to `/api/seats/switch`.
 */
import { instant, type Change, type Site } from '@crawlmouse/types/v2';
import { TRIAL_REMINDER_DAYS_BEFORE_END } from '../../auth/constants';
import { AGENCY_MONTHLY, AGENCY_YEARLY, PRO_MONTHLY, usd } from '../../billing/prices';
import { GATES, type Tier } from '../../entitlement-v2';
import { ACCOUNT_COPY as COPY } from '../copy/account';
import { AGENCY_RAIL_COPY as AGENCY } from '../copy/agency';
import { calendarDays, dayDate, dayMonth, daysBefore, hourMinute } from '../format';
import { count, plural } from '../words';
import {
  PLAN_NAMES,
  primarySite,
  primarySites,
  readerSeat,
  resultChecks,
  type AccountView,
} from './account';
import type { SeatRole } from '../account/profile';
import {
  ACCOUNT_NAV,
  AGENCY_NAV,
  action,
  type ActionView,
  type RailLabel,
} from './account-actions';

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

/** The rail's card for an Agency account outside a trial (Final-Ag-Matrix). */
export interface PlanCardView {
  /** "Agency · $99 a month": the plan and its list price for the account's billing period. */
  title: string;
  /** "25 client sites · 5 seats": what the plan keeps, from the account's limits. */
  counts: string;
  /** "Renews 1 Dec. Card ending 4242.", for the owner of an account that holds both; else null. */
  note: string | null;
  /** The owner's link to billing. */
  billing: ActionView | null;
}

/** An account a person holds an active seat on, as the viewer lists it (`AccountViewer.accounts`). */
export interface SwitcherAccount {
  id: string;
  kind: 'personal' | 'agency';
  name: string | null;
}

/** The rail's account switcher, for a person with seats on several accounts. */
export interface SwitcherView {
  /** The account the page shows, by name: the one acted in, except where `visiting` is set. */
  current: string;
  /** The person's other accounts: each posts its id to the switch. */
  others: ActionView[];
  /**
   * Set where the page shows an account the reader is not acting in (a site page opened by its
   * address): the account they act in, by name, and the switch to the one shown.
   */
  visiting: { acting: string; switchTo: ActionView } | null;
}

export interface ShellView {
  nav: NavItemView[];
  /** "Agency" beside the brand on the agency rail; null on every other. */
  badge: string | null;
  trial: TrialCardView | null;
  /** The Agency plan card; null on every other tier and during a trial, which has `trial`. */
  plan: PlanCardView | null;
  /** Null for a person with one seat, and where the caller's accounts are not given. */
  switcher: SwitcherView | null;
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
  owner: boolean,
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
    // Billing and Keep are the owner's: Settings › Plan and the checkout refuse anyone else.
    billing: owner && firstRun ? action('plan', 'Billing') : null,
    keep:
      !owner || firstRun
        ? null
        : action(
            'keepPlan',
            `Keep ${PLAN_NAMES[tier]}, $${price} a month`,
            {},
            { fields: { plan: tier, interval: 'month' } },
          ),
  };
}

/** An account with no name, or a blank one, reads by its kind. */
const UNNAMED: Record<SwitcherAccount['kind'], string> = {
  personal: 'Personal account',
  agency: 'Agency account',
};

/** An account as the switcher names it. */
export const accountLabel = (a: Pick<SwitcherAccount, 'kind' | 'name'>): string =>
  a.name?.trim() || UNNAMED[a.kind];

const switchTo = (a: SwitcherAccount, label: string): ActionView =>
  action('switchAccount', label, {}, { fields: { accountId: a.id } });

/**
 * The switcher for a person whose active seats are on `accounts`, on a page that shows `shownId`
 * while they act in `actingId` (the same account, unless the page was opened by its address).
 * Null when there is no other account to switch to, or when either id is not one of `accounts`.
 */
export function switcherView(
  accounts: readonly SwitcherAccount[],
  shownId: string,
  actingId: string = shownId,
): SwitcherView | null {
  const shown = accounts.find((a) => a.id === shownId);
  const acting = accounts.find((a) => a.id === actingId);
  const others = accounts.filter((a) => a.id !== shownId);
  if (!shown || !acting || others.length === 0) return null;
  return {
    current: accountLabel(shown),
    others: others
      .map((a) => ({ a, label: accountLabel(a) }))
      .sort((x, y) => x.label.localeCompare(y.label, 'en') || x.a.id.localeCompare(y.a.id))
      .map(({ a, label }) => switchTo(a, label)),
    visiting:
      shown === acting
        ? null
        : {
            acting: accountLabel(acting),
            switchTo: switchTo(shown, AGENCY.switchToAccount(accountLabel(shown))),
          },
  };
}

/** The frame without the actions that act on the account acted in: Keep, and the links to billing. */
function withoutAccountActions(shell: ShellView): ShellView {
  return {
    ...shell,
    trial: shell.trial && { ...shell.trial, keep: null, billing: null },
    plan: shell.plan && { ...shell.plan, billing: null },
  };
}

/**
 * A screen's data with the switcher added to its frame, for a page whose view built the frame
 * without the caller's accounts. `shownId` is the account the page shows and `actingId` the one the
 * caller acts in. Where they differ, the frame offers the switch to the account shown and drops
 * Keep and the billing links: those routes act on the account acted in, which is not this one.
 */
export function withSwitcher<T extends { shell: ShellView }>(
  data: T,
  accounts: readonly SwitcherAccount[],
  shownId: string,
  actingId: string = shownId,
): T {
  const switcher = switcherView(accounts, shownId, actingId);
  const shell = { ...data.shell, switcher };
  return { ...data, shell: switcher?.visiting ? withoutAccountActions(shell) : shell };
}

/** The Agency plan card: the plan's terms for every seat, the renewal and card for the owner. */
function planCard(v: AccountView, owner: boolean): PlanCardView | null {
  const a = v.account;
  if (v.tier !== 'agency' || a.state === 'agency_trial') return null;
  const yearly = a.billing_period_months === 12;
  const renewal =
    owner && a.state === 'agency' && a.renews_at !== null && a.card_last4 !== null
      ? AGENCY.renews(dayMonth(a.renews_at, a.timezone), a.card_last4)
      : null;
  return {
    title: AGENCY.planPrice(
      PLAN_NAMES.agency,
      usd(yearly ? AGENCY_YEARLY : AGENCY_MONTHLY),
      yearly ? 'year' : 'month',
    ),
    counts: AGENCY.planKeeps(a.limits.sites, a.limits.seats),
    note: renewal,
    billing: owner ? action('plan', 'Billing') : null,
  };
}

/** The rail link a page marks: on the agency rail a page under Sites sits under Clients, and back. */
const SAME_PLACE: Partial<Record<RailLabel, RailLabel>> = { Sites: 'Clients', Clients: 'Sites' };

function rail(v: AccountView, current: RailLabel | null): NavItemView[] {
  const fresh = newChanges(v).length;
  const agency = v.tier === 'agency';
  const links: readonly { label: RailLabel; href: string }[] = agency ? AGENCY_NAV : ACCOUNT_NAV;
  const marked = links.some((n) => n.label === current) ? current : current && SAME_PLACE[current];
  return links.map((n) => ({
    ...n,
    count:
      n.label === 'Sites'
        ? String(v.d.sites.length)
        : n.label === 'Clients'
          ? count(primarySites(v).length)
          : n.label === 'Changes' && fresh
            ? `${fresh} new`
            : null,
    current: n.label === marked,
    fresh: n.label === 'Changes' && fresh > 0,
  }));
}

/**
 * The frame for one account screen; `current` names the rail link it is, or null on a page that is
 * none of them. `plan: 'page'` is for a page that carries the plan's terms and Keep action itself.
 */
export function accountShellView(
  v: AccountView,
  current: RailLabel | null,
  {
    plan = 'rail',
    billingEnd = null,
    role,
    accounts,
    actingIn,
  }: {
    /**
     * The reader's seat role: the rail's Billing and Keep are offered to the owner only. It has no
     * default, so a page cannot show a member the owner's rail by leaving it out.
     */
    role: SeatRole;
    plan?: PlanPlace;
    /** A subscription set to cancel at its period's end: a card trial's card is then not charged. */
    billingEnd?: string | null;
    /** The accounts of the reader's active seats; with more than one, the frame has the switcher. */
    accounts?: readonly SwitcherAccount[];
    /** The account the reader acts in, where it may not be this one (`withSwitcher`). */
    actingIn?: string;
  },
): ShellView {
  const seat = readerSeat(v);
  const shell: ShellView = {
    nav: rail(v, current),
    badge: v.tier === 'agency' ? PLAN_NAMES.agency : null,
    trial: trialCard(v, plan, billingEnd, role === 'owner'),
    plan: planCard(v, role === 'owner'),
    switcher: null,
    theme: seat?.theme ?? 'system',
    themeAction: action('theme', 'Theme'),
  };
  return accounts ? withSwitcher({ shell }, accounts, v.account.id, actingIn).shell : shell;
}
