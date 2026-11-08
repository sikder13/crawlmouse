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

export const CC27B_ROUTES = {
  accountAlertRules: {
    verb: 'PUT',
    route: '/api/alert-rules',
    owner: 'CC-27b',
    guard:
      'Signed-in member; the account’s rules (`site_id` null); Slack needs a paid tier. ARCH-2 §5 has only the per-site route: this one is CC-27b’s contract (owner ruling 6).',
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
      'Signed-in owner; sends a confirmation link to the new address (GET renders, POST confirms) and a notice to the old one, so a change made from a stolen session is seen; writes `account_events`.',
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
      'The confirmation link: GET renders the page, POST confirms, so a link scanner cannot delete. On confirm, sign-in is disabled at once, the Stripe subscription cancelled and `account.deleted` sent; a sign-in link within 7 days restores the account (`POST /api/account/restore`); then `accountDeletedFn` purges Storage and hard-deletes (ARCH-2 §5 lifecycle, owner ruling 12).',
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
    owner: 'CC-27b',
    guard:
      'Signed-in member of the report’s account; redirects to a 10-minute signed URL. Under `/api/report-files`, not `/api/reports/[id]`, because `/api/reports/[slug]` is a live segment and Next refuses two names at one level.',
  },
  reportShare: {
    verb: 'POST',
    route: '/api/report-files/[id]/share',
    owner: 'CC-27b',
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
    rule: 'Every CC-27b route that changes state (POST, PUT, PATCH, DELETE, the `_method` forms included) checks the request’s `Origin` against the site’s own, as `app/api/checks/[id]/claim` does, besides the SameSite cookie; a mismatch is refused with 403.',
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
    rule: 'Two clicks from Settings › Plan, with no retention offer in the path; effective at the end of the paid month (Stripe `cancel_at_period_end`); the screen then shows the plan until that date.',
    source: 'DECISION-LOG D5 and L6; ARCH-2 §3.2',
  },
  {
    what: 'Account deletion',
    rule: 'The owner re-types the primary site’s hostname on the confirmation step; a confirmation link then goes to the sign-in address. Opening it disables sign-in at once and cancels the Stripe subscription; a sign-in link within 7 days restores the account (`POST /api/account/restore`); after that `accountDeletedFn` (sleep 7 d, cancelled by the restore) purges Storage prefixes and hard-deletes in dependency order. What the reader is told is FACTS E6’s.',
    source:
      'Owner ruling 12; ARCH-2 §2.3, §3.2, §4.6 and §5; DECISION-LOG E6; SECURITY-DESIGN item 17 (CC-SEC-18)',
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
  danger: { title: string; tableLabel: string; label: string; text: string; action: ActionView };
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
export function settingsView(d: FixtureDataset, viewer: Viewer): SettingsView {
  const v = viewAt(d, viewer);
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
  const card = a.card_last4;
  const cardTrial = trial && card !== null;
  const pastDue = a.state === 'past_due';
  const yearly = v.tier === 'agency' ? AGENCY_YEARLY : PRO_YEARLY;
  const date = (ts: string) => dayDate(ts, zone);
  const pastDueSince = a.state_history.at(-1)!.since;
  const graceEnds = new Date(
    Date.parse(pastDueSince) + PAST_DUE_GRACE_DAYS * 86_400_000,
  ).toISOString();
  const keepShown = (trial && !cardTrial) || v.tier === 'free';
  const monthly = v.tier === 'agency' ? AGENCY_MONTHLY : PRO_MONTHLY;
  const cancel = routeAction('cancelPlan', COPY.cancelAction);
  const portal = routeAction('billingPortal', COPY.portalAction);

  return {
    // The plan card carries the plan's terms and its Keep, so the rail's trial card leaves them out.
    shell: accountShellView(v, 'Settings', { plan: 'page' }),
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
        hint: COPY.emailHint,
      },
      name: {
        id: 'account-name',
        label: COPY.nameLabel,
        name: 'name',
        value: a.name ?? '',
        placeholder: COPY.namePlaceholder,
        hint: COPY.nameHint(agency),
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
      text: COPY.deleteText(v.d.sites.length, DELETE_GRACE_DAYS),
      action: routeAction('deleteConfirm', COPY.deleteAction),
    },
    plan: {
      title: COPY.planTitle,
      name: trial ? COPY.trialName(plan) : plan,
      left: days === null ? null : COPY.daysLeft(days),
      note: trial
        ? `${COPY.ends(date(a.trial_ends_at!))} ${
            card === null ? COPY.noCardTerms(plan) : COPY.cardTerms(card)
          }`
        : pastDue
          ? v.tier === 'free'
            ? COPY.pastDueEnded(date(pastDueSince), date(graceEnds))
            : COPY.pastDue(date(pastDueSince), date(graceEnds), plan)
          : paid
            ? null
            : COPY.freeNote(FREE_SCHEDULE[GATES.free.schedule], FREE_FIXES),
      usageLabel: COPY.tables.usage,
      usage: [
        [COPY.sitesUsed, COPY.of(primarySites(v).length, a.limits.sites)],
        [COPY.pagesUsed, COPY.of(largest, v.gates.pagesPerCheck)],
      ],
      // A trial with a card becomes the plan at its end: there is nothing to keep it by.
      keep:
        trial && !cardTrial
          ? action(
              'keepPlan',
              COPY.keep(plan, v.tier === 'agency' ? AGENCY_MONTHLY : PRO_MONTHLY),
              {},
              {
                fields: { plan: v.tier, interval: 'month' },
              },
            )
          : paid
            ? null
            : action(
                'keepPlan',
                COPY.choose(PLAN_NAMES.pro, PRO_MONTHLY),
                {},
                {
                  fields: { plan: 'pro', interval: 'month' },
                },
              ),
      // "Or …" follows a Keep; where the card has none, the plan's own prices lead.
      other: [
        keepShown
          ? v.tier === 'agency'
            ? COPY.otherYearly(yearly)
            : COPY.other(yearly, AGENCY_MONTHLY, GATES.agency.sites, GATES.agency.seats).replace(
                /^(Or \$\d+ a year\.) /,
                '$1 ',
              )
          : COPY.prices(plan, monthly, yearly),
        ...(!keepShown && v.tier !== 'agency'
          ? [COPY.agencyLine(AGENCY_MONTHLY, GATES.agency.sites, GATES.agency.seats)]
          : []),
      ].join(' '),
      compare: action('pricing', COPY.compare),
      termsLabel: COPY.tables.terms,
      terms: [
        cardTrial
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

// ── Deleting the account: the confirmation step ─────────────────────────────────────────────

export interface DeleteStepView {
  shell: ShellView;
  header: { title: string; line: string };
  cardTitle: string;
  /** What deleting removes, and how long the sign-in email can undo it (FACTS E6). */
  text: string;
  /** How it goes from here: the link to the sign-in address, sign-in stopping, the restore. */
  steps: string;
  /** The in-page guard: the primary site's hostname, typed again. */
  field: { id: string; label: string; name: string; expected: string; hint: string };
  submit: ActionView;
  /** Back to Settings, deleting nothing. */
  back: ActionView;
}

/**
 * The step “Delete…” opens (owner ruling 12): the owner re-types the primary site's hostname (the
 * account's sign-in address when it holds no site), and the form asks for a confirmation link to the
 * sign-in address. Nothing is deleted on this page; the link does it. There is no artboard for it.
 */
export function deleteStepView(d: FixtureDataset, viewer: Viewer): DeleteStepView {
  const v = viewAt(d, viewer);
  const a = v.account;
  const site = primarySites(v).length ? primarySite(v) : null;
  const expected = site ? site.host : a.email;
  return {
    shell: accountShellView(v, 'Settings'),
    header: { title: COPY.deleteLabel, line: a.email },
    cardTitle: COPY.deleteCardTitle,
    text: COPY.deleteText(v.d.sites.length, DELETE_GRACE_DAYS),
    steps: COPY.deleteSteps(site ? COPY.hostnameNoun : COPY.emailNoun, a.email, DELETE_GRACE_DAYS),
    field: {
      id: 'delete-hostname',
      label: COPY.retype(expected),
      name: 'hostname',
      expected,
      hint: COPY.retypeHint,
    },
    submit: routeAction('deleteAccount', COPY.sendDeleteLink),
    back: action('emailSettings', COPY.keepAccount),
  };
}
