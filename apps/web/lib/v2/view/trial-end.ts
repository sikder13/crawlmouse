/**
 * Trial ending (Final-TrialEnd) as data (D7). It is read at the trial's reminder, three days before
 * the end (FACTS A8, `TRIAL_REMINDER_DAYS_BEFORE_END`). What stays is the oldest primary site, the
 * free three fixes of its latest result (CC-22's `freeFixes`) and its public link; what pauses is
 * the other primary sites and the staging copies (ARCH-2 §3.2 "pause others"; staging needs a paid
 * tier), with the paid features the account uses. "What Pro did" counts the account's checks,
 * changes and fixes between the trial's start and `now`, each count the length of the rows it lists.
 */
import { instant, type Change, type FixtureDataset, type Verdict } from '@crawlmouse/types/v2';
import { TRIAL_REMINDER_DAYS_BEFORE_END } from '../../auth/constants';
import { AGENCY_MONTHLY, AGENCY_YEARLY, PRO_MONTHLY, PRO_YEARLY } from '../../billing/prices';
import { GATES } from '../../entitlement-v2';
import { CANCEL_CLICKS, EVIDENCE_CONDENSED_AFTER_DAYS } from '../copy/settings';
import { ACCOUNT_COPY } from '../copy/account';
import { TRIAL_END_COPY as COPY } from '../copy/trial-end';
import { fixesAsOf } from '../fixtures';
import {
  calendarDays,
  dayDate,
  daysBefore,
  hourMinute,
  listOf,
  sameDay,
  weekdayTime,
} from '../format';
import { count } from '../words';
import {
  PLAN_NAMES,
  primarySite,
  primarySites,
  resultChecks,
  viewAt,
  type AccountView,
  type Viewer,
} from './account';
import { ACCOUNT_NAV, action, type ActionView } from './account-actions';
import { FREE_SCHEDULE, accountShellView, type ShellView } from './account-shell';
import { freeFixes } from './free-fixes';
import { GRADES } from './segment/changes';
import type { SeatRole } from '../account/profile';

export interface TrialRowView {
  what: string;
  how: string;
}

export interface DidRowView {
  label: string;
  value: string;
  detail: string;
  /** The verdicts of the crawlers the detail calls blocked, which vouch for the word (FACTS I2). */
  verdicts: Verdict[];
}

export interface TrialEndView {
  shell: ShellView;
  header: { title: string; line: string; actions: ActionView[] };
  /**
   * `keep`: on a trial with no card, the checkout that keeps the plan (the page's orange action);
   * null on a trial with a card, which becomes the plan at its end unless it is cancelled. `end`:
   * leaving it to end (no card, or a card trial already set to cancel), or cancelling it (a card).
   * Both are null for a seat that is not the owner's: the choice is the owner's to make.
   */
  banner: { title: string; sub: string; keep: ActionView | null; end: ActionView | null };
  staysTitle: string;
  stays: TrialRowView[];
  pausesTitle: string;
  pauses: TrialRowView[];
  did: { title: string; sub: string; rows: DidRowView[] };
  keepTitle: string;
  keepText: string;
  endTitle: string;
  endText: string;
  tables: typeof COPY.tables;
  columns: typeof COPY.columns;
}

/** Who reads the screen, and when: the account at its trial's reminder. */
export function trialEndViewer(d: FixtureDataset, accountId: string): Viewer {
  const a = d.accounts.find((x) => x.id === accountId);
  if (!a?.trial_ends_at) throw new Error(`Account ${accountId} has no trial to end`);
  return {
    accountId,
    now: daysBefore(a.trial_ends_at, TRIAL_REMINDER_DAYS_BEFORE_END, a.timezone),
  };
}

/** "Fixes 3–15" for a run of numbers, "Fixes 1, 4 and 7" otherwise. */
function numbersText(numbers: readonly number[]): string {
  const run = numbers.every((n, i) => i === 0 || n === numbers[i - 1]! + 1);
  return run && numbers.length > 2
    ? `${numbers[0]}–${numbers.at(-1)}`
    : listOf(numbers.map(String));
}

/** What a live page knows beyond the dataset: the subscription set to end, and the reader's seat. */
export interface TrialReading {
  /** When a subscription set to cancel at its period's end ends; null when it is not set to. */
  billingEnd?: string | null;
  /** The reader's seat role: only the owner is offered the plan's checkout or its cancel. */
  role?: SeatRole;
}

export function trialEndView(
  d: FixtureDataset,
  viewer: Viewer,
  { billingEnd = null, role = 'owner' }: TrialReading = {},
): TrialEndView {
  const v = viewAt(d, viewer);
  const a = v.account;
  if (a.state !== 'pro_trial' && a.state !== 'agency_trial') {
    throw new Error(`Account ${a.id} is not on a trial at ${v.now}`);
  }
  const zone = a.timezone;
  const at = (ts: string) => instant(ts);
  const plan = PLAN_NAMES[v.tier];
  const end = a.trial_ends_at!;
  const start = a.state_history.at(-1)!.since;
  const price = v.tier === 'agency' ? AGENCY_MONTHLY : PRO_MONTHLY;
  const yearly = v.tier === 'agency' ? AGENCY_YEARLY : PRO_YEARLY;
  const card = a.card_last4;
  const onFile = v.cardOnFile;
  // A card trial set to cancel at its end is not charged: it ends as a trial with no card does.
  const cancelled = onFile && billingEnd !== null;
  const owner = role === 'owner';
  const hostOf = new Map(v.d.sites.map((s) => [s.id, s.host]));
  const checkSite = new Map(v.d.checks.map((c) => [c.id, c.site_id]));

  // ── the header ──
  const days = calendarDays(v.now, end, zone);
  const last = [...v.d.checks].sort((x, y) => at(y.finished_at!) - at(x.finished_at!))[0];
  const lastWhen = last
    ? sameDay(last.finished_at!, v.now, zone)
      ? COPY.today(hourMinute(last.finished_at!, zone))
      : `${dayDate(last.finished_at!, zone)} ${hourMinute(last.finished_at!, zone)}`
    : null;
  const line = [
    dayDate(v.now, zone),
    COPY.sites(v.d.sites.length),
    ...(lastWhen ? [COPY.lastCheck(lastWhen)] : []),
    COPY.trialEnds(dayDate(end, zone)),
  ].join(' · ');

  // ── the banner ──
  const reminder = daysBefore(end, TRIAL_REMINDER_DAYS_BEFORE_END, zone);
  // This page reads no record of the send (CC-28's mailer keeps one in email_sends): the line says
  // when the reminder is due, from its day until that day is over in the account's zone, and nothing
  // after.
  const reminderLine =
    a.email_prefs.trial_reminder && (at(reminder) >= at(v.now) || sameDay(reminder, v.now, zone))
      ? COPY.reminderDue(dayDate(reminder, zone))
      : null;
  const cardLine = !onFile
    ? COPY.noCard
    : card === null
      ? ACCOUNT_COPY.cardManagedByOwner
      : cancelled
        ? COPY.cardCancelled(card, dayDate(end, zone))
        : COPY.card(card, dayDate(end, zone));
  const dashboard = ACCOUNT_NAV[0];

  const {
    site,
    others,
    staging,
    free,
    freeThree,
    open,
    withPacket,
    freeWithPacket,
    stays,
    pauses,
  } = staysAndPauses(v, plan);

  // ── what Pro did, between the trial's start and now ──
  // From the trial's start; `viewAt` already keeps nothing later than `now`.
  const inWindow = (ts: string) => at(ts) >= at(start);
  const checks = v.d.checks
    .filter((c) => inWindow(c.finished_at!))
    .sort((x, y) => at(x.finished_at!) - at(y.finished_at!));
  const onSite = checks.filter((c) => c.site_id === site.id);
  const elsewhere = checks.filter((c) => c.site_id !== site.id);
  const stagingIds = new Set(staging.map((s) => s.id));
  const elsewherePrimary = new Set(
    elsewhere.filter((c) => !stagingIds.has(c.site_id)).map((c) => c.site_id),
  ).size;
  const elsewhereStaging = new Set(
    elsewhere.filter((c) => stagingIds.has(c.site_id)).map((c) => c.site_id),
  ).size;
  const fixOfRecheck = (checkId: string) => {
    const e = v.d.fix_events.find((x) => 'check_id' in x && x.check_id === checkId);
    return e ? (v.d.fixes.find((f) => f.id === e.fix_id)?.number ?? null) : null;
  };
  const checkDates = onSite.map((c) =>
    c.trigger === 'fix_recheck'
      ? COPY.recheck(dayDate(c.finished_at!, zone), fixOfRecheck(c.id))
      : dayDate(c.finished_at!, zone),
  );
  const caught = v.d.changes
    .filter((c) => (c.kind === 'opened' || c.kind === 'resolved') && inWindow(c.detected_at))
    // Problems found before problems fixed, each in the order they were found.
    .sort(
      (x, y) =>
        Number(x.kind === 'resolved') - Number(y.kind === 'resolved') ||
        at(x.detected_at) - at(y.detected_at) ||
        x.id.localeCompare(y.id),
    );
  const caughtText = describeChanges(caught, zone);
  const caughtVerdicts = [
    ...new Set(
      caught.flatMap((c) => {
        const crawler = c.ua
          ? v.d.checks.find((k) => k.id === c.check_id)?.crawlers.find((x) => x.ua === c.ua)
          : undefined;
        return crawler ? [crawler.verdict] : [];
      }),
    ),
  ];
  const closed = caught.filter((c) => c.kind === 'resolved' && c.fix_id !== null);

  return {
    // Reached from the dashboard's banner: it sits under Sites, as Final-TrialEnd marks it.
    shell: accountShellView(v, 'Sites', { plan: 'page', billingEnd, role }),
    header: {
      title: COPY.title(days, plan),
      line,
      actions: [action('runCheck', COPY.runCheck, { id: site.id })],
    },
    banner: {
      title: COPY.bannerTitle(plan, dayDate(end, zone)),
      sub: [reminderLine, cardLine].filter(Boolean).join(' '),
      keep:
        owner && !onFile
          ? action(
              'keepPlan',
              COPY.keepNoCard(plan, price),
              {},
              {
                primary: true,
                fields: { plan: v.tier, interval: 'month', accountId: v.account.id },
              },
            )
          : null,
      end: !owner
        ? null
        : !onFile || cancelled
          ? {
              label: COPY.letItEnd(dayDate(end, zone)),
              route: dashboard.href,
              href: dashboard.href,
              method: 'get',
              fields: {},
              primary: false,
              context: null,
            }
          : action('plan', COPY.cancelBefore(dayDate(end, zone))),
    },
    staysTitle: COPY.staysTitle,
    stays,
    pausesTitle: COPY.pausesTitle(plan),
    pauses,
    did: {
      title: COPY.didTitle(plan, calendarDays(start, v.now, zone)),
      sub: COPY.didSub(dayDate(start, zone), dayDate(v.now, zone)),
      rows: [
        {
          label: COPY.checksRun,
          value: count(checks.length),
          detail:
            [
              ...(onSite.length ? [COPY.checksOn(onSite.length, site.host, checkDates)] : []),
              ...(elsewhere.length
                ? [COPY.checksElsewhere(elsewhere.length, elsewherePrimary, elsewhereStaging)]
                : []),
            ].join(' · ') || COPY.none,
          verdicts: [],
        },
        {
          label: COPY.changesCaught,
          value: count(caught.length),
          detail: caughtText || COPY.none,
          verdicts: caughtVerdicts,
        },
        {
          label: COPY.fixesClosed,
          value: count(closed.length),
          detail:
            closed
              .map((c) =>
                COPY.closedDetail(
                  c.where,
                  hostOf.get(checkSite.get(c.check_id)!)!,
                  dayDate(c.detected_at, zone),
                  c.grade_deltas.map(
                    (g) =>
                      `${GRADES[g.grade]} ${g.from_grade} ${g.from_score} → ${g.to_grade} ${g.to_score}`,
                  ),
                ),
              )
              .join(' · ') || COPY.none,
          verdicts: [],
        },
        {
          label: COPY.openWithPackets,
          value: count(withPacket.length),
          detail: open.length
            ? COPY.openDetail(
                freeWithPacket.length,
                withPacket.length - freeWithPacket.length,
                open.length - withPacket.length,
              )
            : COPY.none,
          verdicts: [],
        },
      ],
    },
    keepTitle: !onFile ? COPY.keepTitle(plan) : COPY.doNothingTitle,
    keepText: [
      !onFile
        ? COPY.keepNoCardText(price, yearly)
        : card === null
          ? ACCOUNT_COPY.cardManagedByOwner
          : cancelled
            ? COPY.cancelledKeepText(card, dayDate(end, zone))
            : COPY.keepCardText(
                card,
                a.billing_period_months === 12 ? yearly : price,
                dayDate(end, zone),
                a.billing_period_months === 12 ? 'year' : 'month',
              ),
      COPY.terms(CANCEL_CLICKS, EVIDENCE_CONDENSED_AFTER_DAYS),
    ].join(' '),
    endTitle: !onFile || cancelled ? COPY.endTitle : COPY.cancelTitle,
    endText: [
      !onFile || cancelled
        ? COPY.endNothing(dayDate(end, zone))
        : COPY.endCancel(dayDate(end, zone), CANCEL_CLICKS),
      COPY.endKeeps(site.host, free, freeThree.length, others.length, staging.length > 0, plan),
    ].join(' '),
    tables: COPY.tables,
    columns: COPY.columns,
  };
}

export interface TrialEndedView {
  shell: ShellView;
  header: { title: string; line: string };
  /** `keep`: the checkout for the plan the trial was of, the page's orange action; the owner's only. */
  banner: { title: string; sub: string; keep: ActionView | null };
  staysTitle: string;
  stays: TrialRowView[];
  pausesTitle: string;
  pauses: TrialRowView[];
  tables: typeof COPY.tables;
  columns: typeof COPY.columns;
}

const TRIAL_TIER = { pro_trial: 'pro', agency_trial: 'agency' } as const;

/**
 * Trial ending after the end (CC-27b D8): an account on Free whose state before was a trial. What
 * stays and what is paused are read as before the end, now on Free. Null for any other account, and
 * for one with no primary site.
 */
export function trialEndedView(
  d: FixtureDataset,
  viewer: Viewer,
  { role = 'owner' }: Pick<TrialReading, 'role'> = {},
): TrialEndedView | null {
  const v = viewAt(d, viewer);
  const a = v.account;
  const before = a.state_history.at(-2)?.state;
  if (a.state !== 'free' || (before !== 'pro_trial' && before !== 'agency_trial')) return null;
  if (primarySites(v).length === 0) return null;
  const tier = TRIAL_TIER[before];
  const plan = PLAN_NAMES[tier];
  const zone = a.timezone;
  const { stays, pauses } = staysAndPauses(v, plan);
  return {
    shell: accountShellView(v, 'Sites', { plan: 'page', role }),
    header: {
      title: COPY.ended.title(plan),
      line: [dayDate(v.now, zone), COPY.sites(v.d.sites.length)].join(' · '),
    },
    banner: {
      title: COPY.ended.banner(plan, dayDate(a.state_history.at(-1)!.since, zone)),
      sub: COPY.ended.sub(plan),
      keep:
        role !== 'owner'
          ? null
          : action(
              'keepPlan',
              COPY.ended.choose(plan, tier === 'agency' ? AGENCY_MONTHLY : PRO_MONTHLY),
              {},
              { primary: true, fields: { plan: tier, interval: 'month', accountId: v.account.id } },
            ),
    },
    staysTitle: COPY.staysTitle,
    stays,
    pausesTitle: COPY.ended.pausesTitle(plan),
    pauses,
    tables: COPY.tables,
    columns: COPY.columns,
  };
}

/**
 * What `GET /trial-ended` shows (spec 27 "Trial ending", one page for both states): the trial still
 * running, read at `now`; the account back on Free after one; null for an account with no trial to
 * show, or with no primary site to show it of.
 */
export function trialPage(
  d: FixtureDataset,
  viewer: Viewer,
  reading: TrialReading = {},
): { kind: 'before'; view: TrialEndView } | { kind: 'after'; view: TrialEndedView } | null {
  const v = viewAt(d, viewer);
  if (primarySites(v).length === 0) return null;
  if (v.account.state === 'pro_trial' || v.account.state === 'agency_trial')
    return { kind: 'before', view: trialEndView(d, viewer, reading) };
  const view = trialEndedView(d, viewer, { role: reading.role });
  return view === null ? null : { kind: 'after', view };
}

/**
 * What stays on Free and what pauses until the plan, for the trial's `plan`: the oldest primary
 * site with its free three, public link and email alerts stay; the other primary sites, the staging
 * copies, the fixes beyond the three and the paid features the account uses pause. Trial ending reads
 * it before the end, and Trial ended after it.
 */
function staysAndPauses(v: AccountView, plan: string) {
  const site = primarySite(v);
  const others = primarySites(v).filter((s) => s.id !== site.id);
  const staging = v.d.sites.filter((s) => s.staging_of_site_id !== null);
  const free = FREE_SCHEDULE[GATES.free.schedule];
  // ── the fixes at the primary site's latest result ──
  const latest = resultChecks(v, site.id).at(-1);
  const open = latest ? fixesAsOf(v.d, latest) : [];
  const freeThree = latest ? freeFixes(v.d, latest) : [];
  const freeIds = new Set(freeThree.map((f) => f.id));
  const onPro = open
    .filter((f) => !freeIds.has(f.id))
    .map((f) => f.number)
    .sort((x, y) => x - y);
  const withPacket = open.filter((f) => f.packet !== null);
  const freeWithPacket = withPacket.filter((f) => freeIds.has(f.id));
  const closedPackets = withPacket.length - freeWithPacket.length;

  // ── what stays and what pauses ──
  const emails = v.account.email_prefs.change_notes;
  const alertsByEmail =
    emails && v.d.alert_rules.some((r) => r.enabled && r.channels.includes('email'));
  const stays: TrialRowView[] = [
    { what: site.host, how: COPY.stays.site(free, alertsByEmail) },
    { what: COPY.stays.evidence, how: COPY.stays.kept(EVIDENCE_CONDENSED_AFTER_DAYS) },
    ...(freeThree.length
      ? [
          {
            what: COPY.stays.freeFixes(freeThree.map((f) => f.number).sort((x, y) => x - y)),
            how: COPY.stays.packetsOpen,
          },
        ]
      : []),
    ...(v.d.reports.some((r) => r.kind === 'public_link' && r.site_id === site.id)
      ? [{ what: COPY.stays.publicLink, how: COPY.stays.keepsWorking }]
      : []),
    ...(alertsByEmail
      ? [{ what: COPY.stays.alerts(site.host), how: COPY.stays.alertsBy(free) }]
      : []),
  ];
  const slack = v.account.integrations.some((i) => i.kind === 'slack' && i.connected);
  const features = [
    ...(GATES.free.schedule !== 'weekly' && v.d.sites.some((s) => s.schedule?.cadence === 'weekly')
      ? [COPY.pauses.features.weekly]
      : []),
    ...(!GATES.free.slack && slack ? [COPY.pauses.features.slack] : []),
    ...(GATES.free.competitorsPerSite === 0 && v.d.sites.some((s) => s.competitor_hosts.length)
      ? [COPY.pauses.features.competitor]
      : []),
    ...(!GATES.free.exports &&
    v.d.reports.some(
      (r) => r.kind === 'audit_pdf' || r.kind === 'compare' || r.kind === 'raw_export',
    )
      ? [COPY.pauses.features.exports]
      : []),
  ];
  const pauses: TrialRowView[] = [
    ...(others.length
      ? [{ what: listOf(others.map((s) => s.host)), how: COPY.pauses.sitesHow }]
      : []),
    ...(staging.length && !GATES.free.stagingAndDeployHooks
      ? [{ what: listOf(staging.map((s) => s.host)), how: COPY.pauses.stagingHow }]
      : []),
    ...(onPro.length
      ? [
          {
            what: COPY.pauses.fixes(numbersText(onPro), onPro.length, plan),
            how: COPY.pauses.fixesHow(closedPackets),
          },
        ]
      : []),
    ...(features.length
      ? [
          {
            what: features.join(', '),
            how: alertsByEmail ? COPY.pauses.featuresHow : COPY.pauses.featuresOff,
          },
        ]
      : []),
  ];

  return {
    site,
    others,
    staging,
    free,
    freeThree,
    open,
    withPacket,
    freeWithPacket,
    stays,
    pauses,
  };
}

/**
 * The changes caught, in words: blocks found together (same day, same cause) are named together,
 * "Claude-SearchBot and ClaudeBot blocked Fri 30 Oct, after robots.txt changed Thu 19:40"; any
 * other change by its summary.
 */
function describeChanges(changes: readonly Change[], zone: string): string {
  const parts: string[] = [];
  const groups = new Map<string, Change[]>();
  for (const c of changes) {
    if (c.kind === 'opened' && c.subject === 'crawler_access' && c.ua) {
      const key = `${dayDate(c.detected_at, zone)} ${c.cause?.changed_at ?? ''} ${c.where}`;
      if (!groups.has(key)) {
        groups.set(key, []);
        parts.push(key);
      }
      groups.get(key)!.push(c);
    } else parts.push(c.id);
  }
  const byId = new Map(changes.map((c) => [c.id, c]));
  return parts
    .map((p) => {
      const group = groups.get(p);
      if (!group) return byId.get(p)!.summary;
      const first = group[0]!;
      const blocked = COPY.blocked(
        group.map((c) => c.ua!),
        dayDate(first.detected_at, zone),
      );
      return first.cause?.changed_at
        ? `${blocked}, ${COPY.after(first.where, weekdayTime(first.cause.changed_at, zone))}`
        : blocked;
    })
    .join(' · ');
}
