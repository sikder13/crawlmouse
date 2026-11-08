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
import { AGENCY_MONTHLY, PRO_MONTHLY, PRO_YEARLY } from '../../billing/prices';
import { GATES } from '../../entitlement-v2';
import { TRIAL_DAYS } from '../copy/account';
import {
  DELETE_GRACE_DAYS,
  EVIDENCE_CONDENSED_AFTER_DAYS,
  SETTINGS_COPY as COPY,
} from '../copy/settings';
import { calendarDays, dayDate, daysBefore } from '../format';
import { PLAN_NAMES, primarySites, resultChecks, viewAt, type Viewer } from './account';
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
      'Owner or manager; `{name, timezone, email_prefs, newEmail}`. A changed `newEmail` starts the `/api/account/email` confirmation instead of saving it. `email_prefs` is not in ARCH-2 §5: CC-27b’s contract (owner ruling 6).',
  },
  emailChange: {
    verb: 'POST',
    route: '/api/account/email',
    owner: 'CC-27b',
    guard:
      'Signed-in owner; sends a confirmation link to the new address (GET renders, POST confirms); writes `account_events`.',
  },
  deleteAccount: {
    verb: 'DELETE',
    route: '/api/account',
    owner: 'CC-27b',
    guard:
      'Signed-in owner and the re-typed hostname; sign-in disabled at once; Stripe subscription cancelled; `account.deleted`, restorable for 7 days by a sign-in link (`POST /api/account/restore`), then Storage purged and the account hard-deleted.',
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
    route: '/api/reports/[id]/download',
    owner: 'CC-27b',
    guard: 'Signed-in member of the report’s account; redirects to a 10-minute signed URL.',
  },
  reportShare: {
    verb: 'POST',
    route: '/api/reports/[id]/share',
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
    terms: [string, string][];
  };
  columns: typeof COPY.columns;
}

/**
 * Settings (Final-Settings) as data (D6): the account's address and name, its three kinds of email
 * (iterated from CC-25's EMAIL_KINDS, senders from its constants), the plan card and the danger
 * zone. The artboard's Connected card is left out (owner ruling: Integrations is its own later
 * page). Every form posts to a CC27B_ROUTES path and is stopped in the preview.
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
      action: routeAction('deleteAccount', COPY.deleteAction),
    },
    plan: {
      title: COPY.planTitle,
      name: trial ? COPY.trialName(plan) : plan,
      left: days === null ? null : COPY.daysLeft(days),
      note: trial
        ? `${COPY.ends(dayDate(a.trial_ends_at!, zone))} ${
            a.card_last4 === null ? COPY.noCardTerms : COPY.cardTerms(a.card_last4)
          }`
        : paid
          ? null
          : COPY.freeNote(FREE_SCHEDULE[GATES.free.schedule], FREE_FIXES),
      usageLabel: COPY.tables.usage,
      usage: [
        [COPY.sitesUsed, COPY.of(primarySites(v).length, a.limits.sites)],
        [COPY.pagesUsed, COPY.of(largest, v.gates.pagesPerCheck)],
      ],
      keep: trial
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
      other: COPY.other(PRO_YEARLY, AGENCY_MONTHLY, GATES.agency.sites, GATES.agency.seats),
      compare: action('pricing', COPY.compare),
      termsLabel: COPY.tables.terms,
      terms: [
        [
          COPY.cancel,
          trial
            ? COPY.cancelTrial(EVIDENCE_CONDENSED_AFTER_DAYS)
            : paid
              ? COPY.cancelPaid(EVIDENCE_CONDENSED_AFTER_DAYS)
              : COPY.cancelFree,
        ],
        [COPY.receipts, COPY.receiptsText],
      ],
    },
    columns: COPY.columns,
  };
}
