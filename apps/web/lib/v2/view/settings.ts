/**
 * Settings (Final-Settings) as data, and the routes CC-27b builds for the account screens CC-27
 * previews (D6: their target paths are constants here). The previews post to these paths and stop
 * the submit; CC-27b implements the handlers on the same paths. The routes CC-26 had already named
 * (`ACCOUNT_ACTIONS`) stay there; these are the ones ARCH-2 §5 lists for the account pages, plus
 * the ones it does not have, each marked as such in its guard (owner ruling 6).
 */
import type { FixtureDataset } from '@crawlmouse/types/v2';
import {
  ALERTS_SENDER,
  AUTH_LINK_MINUTES,
  EMAIL_KINDS,
  SIGNIN_SENDER,
  TRIAL_REMINDER_DAYS_BEFORE_END,
  type EmailKind,
} from '../../auth/constants';
import { AGENCY_MONTHLY, AGENCY_YEARLY, PRO_MONTHLY, PRO_YEARLY } from '../../billing/prices';
import { GATES, PAST_DUE_GRACE_DAYS } from '../../entitlement-v2';
import { TRIAL_DAYS } from '../copy/account';
import {
  CANCEL_CLICKS,
  DELETE_GRACE_DAYS,
  EVIDENCE_CONDENSED_AFTER_DAYS,
  SETTINGS_COPY as COPY,
} from '../copy/settings';
import { calendarDays, dayDate, daysBefore } from '../format';
import {
  PLAN_NAMES,
  primarySite,
  primarySites,
  resultChecks,
  viewAt,
  type Viewer,
} from './account';
import { action, type ActionView, type RouteSpec } from './account-actions';
import { FREE_SCHEDULE, accountShellView, type ShellView } from './account-shell';
import { FREE_FIXES } from './free-fixes';
import { REFUSAL_SENTENCES, SETTINGS_NOTICES as NOTICES } from '../copy/settings-notices';
import type { SeatRole } from '../account/profile';

export const CC27B_ROUTES = {
  accountAlertRules: {
    verb: 'PUT',
    route: '/api/alert-rules',
    owner: 'CC-27b',
    guard:
      'Signed-in member; the account’s rules (`site_id` null); Slack needs a paid tier, and its URL is kept in Vault and never answered back (its last four characters are). ARCH-2 §5 has only the per-site route: this one is CC-27b’s contract (owner ruling 6).',
  },
  account: {
    verb: 'PATCH',
    route: '/api/account',
    owner: 'CC-27b',
    guard:
      'Owner or manager for `{name, timezone, email_prefs}`. A changed `newEmail` needs the owner (a manager’s is refused with 403) and starts the `/api/account/email` confirmation instead of saving it (ARCH-2 §5: the email change is owner only). `email_prefs` is not in ARCH-2 §5: CC-27b’s contract (owner ruling 6).',
  },
  emailChange: {
    verb: 'POST',
    route: '/api/account/email',
    owner: 'CC-27b',
    guard:
      'Signed-in owner; a confirmation link to the new address and, at the same time, a notice to the old one whose link stops the change, or reverts it for 7 days after it applies, so a change made from a stolen session is seen; each link lands at `/account/email[-undo]/[token]`, which moves its token into a cookie, and its page posts to `/api/account/email/confirm` or `/undo`; writes `account_events` (CC-27b D3, owner ruling Q8).',
  },
  deleteConfirm: {
    verb: 'GET',
    route: '/settings/delete',
    owner: 'CC-27b',
    guard:
      'Signed-in owner. The step “Delete…” opens (owner ruling 12): the owner re-types the primary site’s hostname, the in-page guard, and submits `DELETE /api/account`. Not in ARCH-2 §5, which names only the DELETE: CC-27b’s contract.',
  },
  deleteAccount: {
    verb: 'DELETE',
    route: '/api/account',
    owner: 'CC-27b',
    guard:
      'Signed-in owner, with `hostname` equal to the primary site’s (the account’s sign-in address when it has no site). Deletes nothing yet: it emails a confirmation link to the sign-in address and writes `account_events` (`delete_requested`) (owner ruling 12).',
  },
  deleteLink: {
    verb: 'POST',
    route: '/account/delete/[token]',
    owner: 'CC-27b',
    guard:
      'The confirmation link: its GET moves the token into a cookie and redirects to `/account/delete`, whose form posts to `/api/account/delete/confirm` (owner ruling Q1), so a link scanner cannot delete. On confirm, every account the person alone holds is marked, sessions end, sign-in is banned and `account.deletion_confirmed` ends each subscription at its period end; the restore link in the same email undoes it for 7 days (`/account/restore/[token]` → `POST /api/account/restore`); then the daily `purgeDeletedAccountsFn` erases the person (CC-27b D4).',
  },
  cancelPlan: {
    verb: 'POST',
    route: '/api/billing/cancel',
    owner: 'CC-27b',
    guard:
      'Signed-in owner; two clicks, the second on the same page, with no retention offer in the path (DECISION-LOG D5, L6); Stripe `cancel_at_period_end`, so the plan, or a trial with a card, runs to its end. Not in ARCH-2 §5 (§3.2 has the transition): CC-27b’s contract.',
  },
  billingPortal: {
    verb: 'POST',
    route: '/api/billing/portal',
    owner: 'built',
    guard:
      'Signed-in owner; opens the Stripe portal, where receipts are listed and a plan is cancelled.',
  },
  reportDownload: {
    verb: 'GET',
    route: '/api/report-files/[id]/download',
    owner: 'wave 2',
    guard:
      'Signed-in member of the report’s account; redirects to a 10-minute signed URL. Under `/api/report-files`, not `/api/reports/[id]`, because `/api/reports/[slug]` is a live segment and Next refuses two names at one level.',
  },
  reportShare: {
    verb: 'POST',
    route: '/api/report-files/[id]/share',
    owner: 'wave 2',
    guard: 'Signed-in member; a share link works for 30 days and needs no account to open.',
  },
  trialEnded: {
    verb: 'GET',
    route: '/trial-ended',
    owner: 'CC-27b',
    guard:
      'Signed-in member. Serves both states: before the end (this preview, and the reminder email’s link) and after it (ARCH-2 §5: “free after trial”). The dashboard banner links to it (owner ruling 6).',
  },
} as const satisfies Record<string, RouteSpec>;

export type Cc27bKey = keyof typeof CC27B_ROUTES;

/**
 * What CC-27b must hold beyond the routes, each with where it is decided. SPEC 27 lists these with
 * the route table; nothing in the previews enforces them.
 */
export const CC27B_REQUIREMENTS = [
  {
    what: 'Cross-site requests',
    rule: 'Every CC-27b route that changes state (POST, PUT, PATCH, DELETE, the `_method` forms included) checks the request’s `Origin` against the site’s own, besides the SameSite cookie, and refuses a mismatch or a missing `Origin` with 403 (`app/api/checks/[id]/claim` lets a missing one through; these routes do not).',
    source: 'CC-27 review round 2 (correctness and security)',
  },
  {
    what: 'Slack webhook URLs',
    rule: 'Stored in `alert_rules.destination` through Supabase Vault (`vault.create_secret`) and decrypted only inside `alertFn`; if Vault is not enabled, AES-GCM with `SLACK_SECRET_KEY` in app code. Never granted to a client role (the column grant leaves it out); the screens show its last four characters.',
    source: 'ARCH-2 §2.11 and §10 Q4',
  },
  {
    what: 'Unsubscribe',
    rule: 'Change notes and the trial reminder carry RFC 8058 one-click unsubscribe headers: `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. The sign-in link carries none: it is sent only when asked for.',
    source: 'DECISION-LOG D6; sent by CC-28’s mailer',
  },
  {
    what: 'Cancel',
    rule: 'Two clicks from Settings › Plan, with no retention offer in the path; effective at the end of the paid period, month or year (Stripe `cancel_at_period_end`); the screen then shows the plan until that date.',
    source: 'DECISION-LOG D5 and L6; ARCH-2 §3.2',
  },
  {
    what: 'Account deletion',
    rule: 'The owner re-types the primary site’s hostname on the confirmation step; a confirmation link then goes to the sign-in address. Confirming it disables sign-in at once and sets the Stripe subscription to end; the restore link in the same email undoes it for 7 days (`POST /api/account/restore`); after that the daily `purgeDeletedAccountsFn` runs the one erasure (`erase_person_apply`), which removes the Storage objects, the rows and the Auth user. What the reader is told is FACTS E6’s.',
    source:
      'Owner ruling 12; ARCH-2 §2.3, §3.2, §4.6 and §5; DECISION-LOG E6; SECURITY-DESIGN item 17 (CC-SEC-18)',
  },
  {
    what: 'Report requests',
    rule: '`POST /api/reports` checks that the posted `siteId` is on the caller’s account and that `checkId`, and a compare’s `previousCheckId`, are results of that site, the previous older than the latest; otherwise 404.',
    source: 'CC-27 review round 3 (correctness and security)',
  },
  {
    what: 'Settings › Plan with no sites',
    rule: '`GET /settings/plan` answers for an account that holds no site: billing must be reachable after every site is removed.',
    source: 'CC-27 brief, scope 6',
  },
  {
    what: 'Trial ending',
    rule: 'One page, `GET /trial-ended`, for both states: before the end (this preview; the reminder email links to it) and after it, as ARCH-2 §5 has it for an account back on Free; the dashboard banner links to it.',
    source: 'Owner ruling 6',
  },
] as const;

/**
 * One of these routes as an action, built as `action()` builds the account screens' others (a link
 * for GET; otherwise a POST form, the verb in `_method`), so ActionControl draws either alike.
 */
export function routeAction(
  key: Cc27bKey,
  label: string,
  params: Record<string, string> = {},
  {
    primary = false,
    fields = {},
    context = null,
  }: { primary?: boolean; fields?: Record<string, string>; context?: string | null } = {},
): ActionView {
  const spec: RouteSpec = CC27B_ROUTES[key];
  const href = spec.route.replace(/\[(\w+)\]/g, (_m, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`${spec.route} needs ${name}`);
    return encodeURIComponent(value);
  });
  return {
    label,
    route: spec.route,
    href,
    method: spec.verb === 'GET' ? 'get' : 'post',
    fields:
      spec.verb === 'GET' || spec.verb === 'POST' ? fields : { _method: spec.verb, ...fields },
    primary,
    context,
  };
}

// ── Settings ─────────────────────────────────────────────────────────────────────────────────

export interface FieldView {
  id: string;
  label: string;
  name: string;
  value: string;
  placeholder: string | null;
  hint: string;
  /** Shown but not changeable by this reader: the sign-in address, for anyone but the owner. */
  readOnly: boolean;
}

export interface EmailKindRowView {
  kind: EmailKind;
  label: string;
  detail: string;
  /** Sign-in links cannot be turned off; the other two are switches over `email_prefs`. */
  control: { always: string } | { name: string; on: boolean; action: ActionView };
}

export interface SettingsView {
  shell: ShellView;
  header: { title: string; line: string };
  account: {
    title: string;
    email: FieldView;
    name: FieldView;
    signIn: { title: string; text: string };
    /** The account form's submit: name and address together (CC27B_ROUTES.account). */
    save: ActionView;
  };
  email: { title: string; tableLabel: string; rows: EmailKindRowView[]; foot: string };
  /** `action` is null for anyone but the owner: deleting is the owner's alone. */
  danger: {
    title: string;
    tableLabel: string;
    label: string;
    text: string;
    action: ActionView | null;
  };
  plan: {
    title: string;
    name: string;
    left: string | null;
    /** The trial's end and what the card on file means, or Free's limits; null on a paid plan. */
    note: string | null;
    usageLabel: string;
    usage: [string, string][];
    keep: ActionView | null;
    other: string;
    compare: ActionView;
    termsLabel: string;
    /** Cancel and Receipts, each with its control where the account has one to use. */
    terms: { label: string; text: string; action: ActionView | null }[];
  };
  columns: typeof COPY.columns;
}

/**
 * Settings (Final-Settings) as data (D6): the account's address and name, its three kinds of email
 * (iterated from CC-25's EMAIL_KINDS, senders from its constants), the plan card and the danger
 * zone. The artboard's Connected card is left out (owner ruling: Integrations is its own later
 * page). Its forms post to CC27B_ROUTES paths, and Keep to the checkout route ACCOUNT_ACTIONS names;
 * the preview stops each submit.
 */
export function settingsView(
  d: FixtureDataset,
  viewer: Viewer,
  {
    billingEnd = null,
    role = 'owner',
    subscriptionStatus,
  }: {
    /** The subscription mirror's `status`, or null for none; left out in a preview (`deleteText`). */
    subscriptionStatus?: string | null;
    /** When a paid plan set to cancel at its period's end ends (the subscription mirror's
     * current_period_end); null when it is not set to. The contract's Account has no field for it. */
    billingEnd?: string | null;
    /**
     * The reader's seat role. The owner alone changes the sign-in address, deletes the account, and
     * reaches the checkout, the cancel and the billing portal (spec 27's guards); a manager keeps the
     * name and the email kinds. A preview reads as the owner.
     */
    role?: SeatRole;
  } = {},
): SettingsView {
  const v = viewAt(d, viewer);
  const owner = role === 'owner';
  const a = v.account;
  const zone = a.timezone;
  const trial = a.state === 'pro_trial' || a.state === 'agency_trial';
  const plan = PLAN_NAMES[v.tier];
  const days = trial ? calendarDays(v.now, a.trial_ends_at!, zone) : null;
  const agency = v.gates.agencyBranding;

  const reminder = trial
    ? dayDate(daysBefore(a.trial_ends_at!, TRIAL_REMINDER_DAYS_BEFORE_END, zone), zone)
    : COPY.noTrial;
  const pref = (name: keyof typeof a.email_prefs, label: string) => ({
    name,
    on: a.email_prefs[name],
    action: routeAction('account', label),
  });
  const rowOf: Record<EmailKind, () => EmailKindRowView> = {
    sign_in_link: () => ({
      kind: 'sign_in_link',
      label: COPY.kinds.sign_in_link,
      detail: COPY.signInDetail(SIGNIN_SENDER),
      control: { always: COPY.always },
    }),
    change_note: () => ({
      kind: 'change_note',
      label: COPY.kinds.change_note,
      detail: COPY.changeNoteDetail(ALERTS_SENDER),
      control: pref('change_notes', COPY.kinds.change_note),
    }),
    trial_reminder: () => {
      const label = COPY.kinds.trial_reminder(TRIAL_REMINDER_DAYS_BEFORE_END, TRIAL_DAYS);
      return {
        kind: 'trial_reminder',
        label,
        detail: reminder,
        control: pref('trial_reminder', label),
      };
    },
  };

  // The largest site: the most pages its latest result crawled.
  const largest = Math.max(
    0,
    ...v.d.sites.map((s) => resultChecks(v, s.id).at(-1)?.coverage?.pages_crawled ?? 0),
  );
  const paid = v.tier !== 'free';
  const ending = paid && billingEnd !== null ? billingEnd : null;
  const card = a.card_last4;
  const cardTrial = trial && card !== null;
  const pastDue = a.state === 'past_due';
  const yearly = v.tier === 'agency' ? AGENCY_YEARLY : PRO_YEARLY;
  const date = (ts: string) => dayDate(ts, zone);
  const pastDueSince = a.state_history.at(-1)!.since;
  const graceEnds = new Date(
    Date.parse(pastDueSince) + PAST_DUE_GRACE_DAYS * 86_400_000,
  ).toISOString();
  const monthly = v.tier === 'agency' ? AGENCY_MONTHLY : PRO_MONTHLY;
  // A trial with a card becomes the plan at its end, and an account past due on Free gets back by
  // updating its card: neither has a Keep. A trial with no card keeps its plan; Free chooses Pro.
  const keep = !owner
    ? null
    : trial && !cardTrial
      ? action(
          'keepPlan',
          COPY.keep(plan, monthly),
          {},
          { fields: { plan: v.tier, interval: 'month' } },
        )
      : v.tier === 'free' && !pastDue
        ? action(
            'keepPlan',
            COPY.choose(PLAN_NAMES.pro, PRO_MONTHLY),
            {},
            {
              fields: { plan: 'pro', interval: 'month' },
            },
          )
        : null;
  const keepShown = keep !== null;
  const cancel = owner ? routeAction('cancelPlan', COPY.cancelAction) : null;
  const portal = owner ? routeAction('billingPortal', COPY.portalAction) : null;

  return {
    // The plan card carries the plan's terms and its Keep, so the rail's trial card leaves them out.
    shell: accountShellView(v, 'Settings', { plan: 'page', billingEnd, role }),
    header: {
      title: COPY.title,
      line: [a.email, trial ? COPY.trialLeft(plan, days!) : plan].join(' · '),
    },
    account: {
      title: COPY.accountTitle,
      email: {
        id: 'account-email',
        label: COPY.emailLabel,
        name: 'newEmail',
        value: a.email,
        placeholder: null,
        hint: owner ? COPY.emailHint : COPY.emailOwnerOnly,
        readOnly: !owner,
      },
      name: {
        id: 'account-name',
        label: COPY.nameLabel,
        name: 'name',
        value: a.name ?? '',
        placeholder: COPY.namePlaceholder,
        hint: COPY.nameHint(agency),
        readOnly: false,
      },
      signIn: { title: COPY.signInTitle, text: COPY.signIn(AUTH_LINK_MINUTES) },
      save: routeAction('account', COPY.save, {}, { primary: true }),
    },
    email: {
      title: COPY.emailTitle,
      tableLabel: COPY.tables.email,
      rows: EMAIL_KINDS.map((k) => rowOf[k]()),
      foot: COPY.emailFoot(EMAIL_KINDS.length),
    },
    danger: {
      title: COPY.dangerTitle,
      tableLabel: COPY.tables.danger,
      label: COPY.deleteLabel,
      text: deleteText(v, subscriptionStatus),
      action: owner ? routeAction('deleteConfirm', COPY.deleteAction) : null,
    },
    plan: {
      title: COPY.planTitle,
      name: trial ? COPY.trialName(plan) : plan,
      left: days === null ? null : COPY.daysLeft(days),
      // A plan set to end is said first: a card trial set to cancel is not charged.
      note:
        cardTrial && ending !== null
          ? COPY.trialCancelling(plan, date(ending), card)
          : trial
            ? `${COPY.ends(date(a.trial_ends_at!))} ${
                card === null ? COPY.noCardTerms(plan) : COPY.cardTerms(card)
              }`
            : pastDue
              ? v.tier === 'free'
                ? COPY.pastDueEnded(date(pastDueSince), date(graceEnds))
                : COPY.pastDue(date(pastDueSince), date(graceEnds), plan)
              : ending !== null
                ? COPY.cancelling(plan, date(ending))
                : paid
                  ? null
                  : COPY.freeNote(FREE_SCHEDULE[GATES.free.schedule], FREE_FIXES),
      usageLabel: COPY.tables.usage,
      usage: [
        [COPY.sitesUsed, COPY.of(primarySites(v).length, a.limits.sites)],
        [COPY.pagesUsed, COPY.of(largest, v.gates.pagesPerCheck)],
      ],
      // A trial with a card becomes the plan at its end: there is nothing to keep it by.
      keep,
      // "Or …" follows a Keep; where the card has none, the plan's own prices lead.
      other: [
        keepShown
          ? v.tier === 'agency'
            ? COPY.otherYearly(yearly)
            : COPY.other(yearly, AGENCY_MONTHLY, GATES.agency.sites, GATES.agency.seats)
          : COPY.prices(plan, monthly, yearly),
        ...(!keepShown && v.tier !== 'agency'
          ? [COPY.agencyLine(AGENCY_MONTHLY, GATES.agency.sites, GATES.agency.seats)]
          : []),
      ].join(' '),
      compare: action('pricing', COPY.compare),
      termsLabel: COPY.tables.terms,
      terms: [
        cardTrial && ending !== null
          ? { label: COPY.cancel, text: COPY.trialCancelled(date(ending)), action: null }
          : cardTrial
            ? {
                label: COPY.cancel,
                text: COPY.cancelCardTrial(
                  date(a.trial_ends_at!),
                  CANCEL_CLICKS,
                  EVIDENCE_CONDENSED_AFTER_DAYS,
                ),
                action: cancel,
              }
            : trial
              ? {
                  label: COPY.cancel,
                  text: COPY.cancelTrial(CANCEL_CLICKS, EVIDENCE_CONDENSED_AFTER_DAYS),
                  action: null,
                }
              : ending !== null
                ? {
                    label: COPY.cancel,
                    text: COPY.cancelled(date(ending), EVIDENCE_CONDENSED_AFTER_DAYS),
                    action: null,
                  }
                : paid
                  ? {
                      label: COPY.cancel,
                      text: COPY.cancelPaid(
                        CANCEL_CLICKS,
                        EVIDENCE_CONDENSED_AFTER_DAYS,
                        a.billing_period_months === 12 ? 'year' : 'month',
                      ),
                      action: cancel,
                    }
                  : { label: COPY.cancel, text: COPY.cancelFree, action: null },
        // A card on file means a Stripe customer, whose receipts the portal lists.
        card === null
          ? { label: COPY.receipts, text: COPY.noReceipts, action: null }
          : { label: COPY.receipts, text: COPY.receiptsText, action: portal },
      ],
    },
    columns: COPY.columns,
  };
}

/**
 * What deleting removes, and what happens to the money, by the state of the subscription mirror
 * (owner ruling Q7, fix round 2): `active` or `trialing` is set to end at the end of the paid period
 * at the confirm; `past_due`, `unpaid` or `paused` is not, and the purge cancels it at once; any other
 * state, or none, has nothing to say. Each with what the published refund policy (Terms §8) says.
 * `undefined` is a preview, which has no mirror: it is read from the tier and the billing period.
 */
function deleteText(v: ReturnType<typeof viewAt>, status: string | null | undefined): string {
  const text = COPY.deleteText(v.d.sites.length, DELETE_GRACE_DAYS);
  const billed: 'ends' | 'failed' | null =
    status === undefined
      ? v.tier !== 'free' && v.account.billing_period_months !== null
        ? 'ends'
        : null
      : status !== null && Object.hasOwn(SUBSCRIPTION_MONEY, status)
        ? SUBSCRIPTION_MONEY[status]!
        : null;
  return billed === null ? text : `${text} ${COPY.deleteMoney[billed]}`;
}

const SUBSCRIPTION_MONEY: Readonly<Record<string, 'ends' | 'failed'>> = {
  active: 'ends',
  trialing: 'ends',
  past_due: 'failed',
  unpaid: 'failed',
  paused: 'failed',
};

// ── Deleting the account: the confirmation step ─────────────────────────────────────────────

export interface DeleteStepView {
  shell: ShellView;
  header: { title: string; line: string };
  cardTitle: string;
  /** What deleting removes, and how long the restore link in the email can undo it (FACTS E6, Q16). */
  text: string;
  /** How it goes from here: the link to the sign-in address, sign-in stopping, the restore. */
  steps: string;
  /**
   * The accounts the person alone holds, which go with them (plan-revision R2), when the page was
   * given them; null otherwise, as in a preview.
   */
  removes: string | null;
  /** The in-page guard: the primary site's hostname, typed again. */
  field: { id: string; label: string; name: string; expected: string; hint: string };
  /** Why the request would be refused, when it would be; null otherwise. */
  blocked: string | null;
  /** The request for the link; null for anyone but the owner, and when it would be refused. */
  submit: ActionView | null;
  /** Back to Settings, deleting nothing. */
  back: ActionView;
}

/**
 * The step “Delete…” opens (owner ruling 12): the owner re-types the primary site's hostname (the
 * account's sign-in address when it holds no site), and the form asks for a confirmation link to the
 * sign-in address. Nothing is deleted on this page; the link does it. There is no artboard for it.
 */
export function deleteStepView(
  d: FixtureDataset,
  viewer: Viewer,
  {
    removes = null,
    role = 'owner',
    blocked = null,
    subscriptionStatus,
  }: {
    /** The subscription mirror's `status`, or null for none; left out in a preview (`deleteText`). */
    subscriptionStatus?: string | null;
    /** The code the request would be refused with (`account_deletion_blocked`), or null. */
    blocked?: string | null;
    /** Each account the erasure plan names, by its primary site's host (null for none). */
    removes?: readonly { host: string | null }[] | null;
    /** The reader's seat role: the request is the owner's alone. A preview reads as the owner. */
    role?: SeatRole;
  } = {},
): DeleteStepView {
  const v = viewAt(d, viewer);
  const a = v.account;
  const site = primarySites(v).length ? primarySite(v) : null;
  const expected = site ? site.host : a.email;
  return {
    shell: accountShellView(v, 'Settings', { role }),
    header: { title: COPY.deleteLabel, line: a.email },
    cardTitle: COPY.deleteCardTitle,
    text: deleteText(v, subscriptionStatus),
    steps: COPY.deleteSteps(site ? COPY.hostnameNoun : COPY.emailNoun, a.email, DELETE_GRACE_DAYS),
    removes:
      removes === null || removes.length === 0
        ? null
        : COPY.removes(removes.map((r) => r.host ?? COPY.noSiteAccount)),
    field: {
      id: 'delete-hostname',
      label: COPY.retype(expected),
      name: 'hostname',
      expected,
      hint: COPY.retypeHint,
    },
    blocked:
      blocked === null
        ? null
        : Object.hasOwn(REFUSAL_SENTENCES, blocked)
          ? REFUSAL_SENTENCES[blocked]!
          : NOTICES.unknown,
    submit:
      role === 'owner' && blocked === null
        ? routeAction('deleteAccount', COPY.sendDeleteLink)
        : null,
    back: action('emailSettings', COPY.keepAccount),
  };
}
