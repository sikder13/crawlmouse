/**
 * Alerts (Final-Alerts) as data. "Fired" is computed from `changes[].notified` (D4): one row per
 * change that was notified by `now`, grouped into one message per site per check, with the channels
 * and Slack channel the change records. "Where alerts go" reads the account's address, its
 * change-note preference (the field Settings shows) and its Slack integration; the rules are the
 * account's `alert_rules`. Every count a sentence states is the length of a list built here.
 */
import { instant, type Change, type FixtureDataset, type Verdict } from '@crawlmouse/types/v2';
import { ALERTS_SENDER } from '../../auth/constants';
import { ALERTS_COPY as COPY, ALERT_PILLS, GRADE_SHORT } from '../copy/alerts';
import { TRIAL_DAYS } from '../copy/account';
import { ALERT_LABELS } from '../copy/site';
import { findCheck } from '../fixtures';
import { dayDate, dayMonth, hourMinute, weekday, weekdayTime } from '../format';
import { primarySite, primarySites, viewAt, type Viewer } from './account';
import { action, type ActionView } from './account-actions';
import { accountShellView, type ShellView } from './account-shell';
import { accountChanges } from './changes-log';
import { PILL, GRADES } from './segment/changes';
import { routeAction } from './settings';

type PillState = (typeof PILL)[keyof typeof PILL] | 'warn';

/**
 * The verdicts "blocked" names (FACTS I2), the ones the crawler rule fires on: the pair CC-26's
 * site view names for the same rule.
 */
const BLOCKING_VERDICTS: Verdict[] = ['disallowed_by_robots', 'blocked_by_ua_rule'];

export interface FiredRowView {
  key: string;
  /** When it was sent, in the account's zone. */
  when: string;
  site: string;
  pill: { state: PillState; label: string };
  what: string;
  /** "email, #seo": the channels, Slack by its channel. */
  to: string;
  /** The check that found it. */
  open: ActionView;
  /** A row about the problem the header's action fixes: its Open is drawn as a button, not quiet. */
  lead: boolean;
  /** The crawler's verdict at that check, for a change about one crawler (it vouches "blocked"). */
  verdicts: Verdict[];
}

/** One message: the rows a site's check sent together. */
export interface MessageView {
  siteId: string;
  checkId: string;
  host: string;
  sentAt: string;
  email: boolean;
  slack: boolean;
  rows: FiredRowView[];
}

export interface ChannelRowView {
  label: string;
  value: string;
  state: { state: 'ok' | 'neutral'; label: string } | null;
  action: ActionView | null;
}

export interface RuleRowView {
  key: string;
  label: string;
  /** The verdicts the rule fires on, for the crawler rule; none otherwise. */
  verdicts: Verdict[];
  on: boolean;
  toggle: ActionView;
}

export interface AlertsView {
  shell: ShellView;
  /** `verdicts`: those of the open blocks the line names. */
  header: { title: string; line: string; verdicts: Verdict[]; actions: ActionView[] };
  fired: {
    title: string;
    sub: string;
    rows: FiredRowView[];
    messages: MessageView[];
    foot: string | null;
    empty: string | null;
  };
  channels: { title: string; rows: ChannelRowView[]; foot: string };
  rules: { title: string; rows: RuleRowView[]; foot: string | null; empty: string | null };
}

const at = (ts: string) => instant(ts);

export function alertsView(d: FixtureDataset, viewer: Viewer): AlertsView {
  const v = viewAt(d, viewer);
  const zone = v.account.timezone;
  const when = (ts: string) => `${dayDate(ts, zone)} ${hourMinute(ts, zone)}`;
  const siteOf = new Map(v.d.sites.map((s) => [s.id, s]));
  const siteOfCheck = (checkId: string) => siteOf.get(findCheck(v.d, checkId).site_id)!;
  const changes = accountChanges(v); // notifications not yet sent at `now` are dropped here
  const sent = changes.filter((c): c is Change & { notified: NonNullable<Change['notified']> } =>
    Boolean(c.notified),
  );

  // The sent problems whose fix is still open: the header names them and opens the first.
  const openFixes = new Set(
    v.d.fixes.filter((f) => f.status !== 'verified_resolved').map((f) => f.id),
  );
  const open = sent.filter((c) => c.kind === 'opened' && c.fix_id && openFixes.has(c.fix_id));
  const openIds = new Set(open.map((c) => c.id));

  const verdictsOf = (c: Change): Verdict[] => {
    const crawler = c.ua
      ? findCheck(v.d, c.check_id).crawlers.find((x) => x.ua === c.ua)
      : undefined;
    return crawler ? [crawler.verdict] : [];
  };

  const what = (c: Change): string => {
    const check = findCheck(v.d, c.check_id);
    const host = siteOfCheck(c.check_id).host;
    const pages =
      c.pages_affected === check.coverage?.pages_crawled
        ? COPY.allPages
        : COPY.pages(c.pages_affected);
    const cause = c.cause?.changed_at
      ? COPY.causeChanged(c.where, weekdayTime(c.cause.changed_at, zone))
      : null;
    if (c.subject === 'crawler_access' && c.ua)
      return [`${c.ua}, ${pages}`, cause].filter(Boolean).join(' · ');
    if (c.subject === 'grade')
      return c.grade_deltas
        .map(
          (g) => `${GRADES[g.grade]} ${g.from_grade} ${g.from_score} → ${g.to_grade} ${g.to_score}`,
        )
        .join(', ');
    const deltas = c.grade_deltas.map((g) => {
      const n = g.to_score - g.from_score;
      return `${GRADE_SHORT[g.grade]} ${n >= 0 ? '+' : '−'}${Math.abs(n)}`;
    });
    if (c.subject === 'deploy' && !deltas.length) return COPY.noGradeChange;
    // The summary may begin with the site's host, which the Site column already shows.
    const summary = c.summary.startsWith(`${host}: `)
      ? c.summary.slice(host.length + 2)
      : c.summary;
    return [summary, ...deltas].join(' · ');
  };

  const pillOf = (c: Change): FiredRowView['pill'] => {
    const label = ALERT_PILLS[c.kind]?.[c.subject] ?? c.kind;
    if (c.kind === 'opened') return { label, state: c.severity === 'warn' ? 'warn' : 'bad' };
    if (c.subject === 'grade') {
      const fell = c.grade_deltas.some((g) => g.to_score < g.from_score);
      return { label, state: fell ? 'bad' : 'ok' };
    }
    if (c.subject === 'deploy') return { label, state: 'ok' };
    return { label, state: PILL[c.kind] };
  };

  const rowOf = (c: (typeof sent)[number]): FiredRowView => {
    const site = siteOfCheck(c.check_id);
    const n = c.notified;
    return {
      key: c.id,
      when: when(n.sent_at),
      site: site.host,
      pill: pillOf(c),
      what: what(c),
      to: n.channels
        .map((ch) => (ch === 'email' ? COPY.email.toLowerCase() : (n.slack_channel ?? COPY.slack)))
        .join(', '),
      lead: openIds.has(c.id),
      verdicts: verdictsOf(c),
      open: action(
        'openAudit',
        COPY.openAction,
        { checkId: c.check_id },
        { context: `${site.host}, ${when(n.sent_at)}` },
      ),
    };
  };

  // Messages: one per site per check, newest sent first; within a send, sites in the order they
  // were added, then rows by id.
  const byKey = new Map<string, MessageView>();
  for (const c of sent) {
    const site = siteOfCheck(c.check_id);
    const key = `${site.id} ${c.check_id}`;
    const m =
      byKey.get(key) ??
      byKey
        .set(key, {
          siteId: site.id,
          checkId: c.check_id,
          host: site.host,
          sentAt: c.notified.sent_at,
          email: false,
          slack: false,
          rows: [],
        })
        .get(key)!;
    m.email ||= c.notified.channels.includes('email');
    m.slack ||= c.notified.channels.includes('slack');
    if (at(c.notified.sent_at) > at(m.sentAt)) m.sentAt = c.notified.sent_at;
    m.rows.push(rowOf(c));
  }
  const order = (siteId: string) => at(siteOf.get(siteId)!.created_at);
  const messages = [...byKey.values()]
    .map((m) => ({ ...m, rows: [...m.rows].sort((a, b) => a.key.localeCompare(b.key)) }))
    .sort((a, b) => at(b.sentAt) - at(a.sentAt) || order(a.siteId) - order(b.siteId));
  const rows = messages.flatMap((m) => m.rows);

  // ── the header ──
  const emails = messages.filter((m) => m.email);
  const since = dayMonth(v.account.state_history[0]!.since, zone);
  const openNames = open.map((c) => (c.ua ? COPY.blocked(c.ua) : c.summary));
  const line = emails.length
    ? [
        COPY.headline(emails.length, since, when(emails[0]!.sentAt)),
        ...(open.length ? [COPY.open(openNames)] : []),
      ].join(' · ')
    : messages.length
      ? COPY.slackOnly(since, messages.length, when(messages[0]!.sentAt))
      : COPY.nothingSent;
  const first = open[0];
  const actions = first
    ? [
        action(
          'packet',
          COPY.openFix(first.ua ?? first.summary),
          { checkId: first.check_id, fixId: first.fix_id! },
          { primary: true },
        ),
      ]
    : [];

  // ── the footnote, built from the messages ──
  const emailClauses = [...new Set(emails.map((m) => m.sentAt))].map((t) =>
    COPY.emailsAt(
      weekdayTime(t, zone),
      emails.filter((m) => m.sentAt === t).map((m) => COPY.emailFor(m.host, m.rows.length)),
    ),
  );
  const slackOnly = messages
    .filter((m) => m.slack && !m.email)
    .map((m) => {
      const site = siteOf.get(m.siteId)!;
      const deploy = findCheck(v.d, m.checkId).trigger === 'deploy';
      return COPY.slackFor(
        deploy
          ? site.staging_of_site_id
            ? COPY.stagingDeploy
            : COPY.deploy
          : COPY.siteAlert(site.host),
      );
    });

  // ── where alerts go ──
  const slack = v.account.integrations.find((i) => i.kind === 'slack');
  const trial = v.account.state === 'pro_trial' || v.account.state === 'agency_trial';
  const primary = primarySites(v).length ? primarySite(v) : null;
  const channels: ChannelRowView[] = [
    {
      label: COPY.email,
      value: v.account.email,
      state: v.account.email_prefs.change_notes
        ? { state: 'ok', label: COPY.on }
        : { state: 'neutral', label: COPY.off },
      action: null,
    },
    {
      label: COPY.slack,
      value: !v.gates.slack
        ? COPY.slackOnPro
        : slack?.connected
          ? (slack.label ?? COPY.slack)
          : COPY.slackNotConnected,
      state:
        v.gates.slack && slack?.connected
          ? { state: 'ok', label: COPY.on }
          : { state: 'neutral', label: COPY.off },
      action: null,
    },
    {
      label: COPY.slackPerSite,
      value: COPY.slackPerSiteValue,
      state: null,
      action: primary ? action('sitePage', COPY.openSite, { id: primary.id }) : null,
    },
  ];

  // ── the rules ──
  const rules = v.d.alert_rules.filter((r) => r.site_id === null);
  const off = rules.filter((r) => !r.enabled);
  const label = (r: (typeof rules)[number]) => ALERT_LABELS[r.kind](r.threshold_points);
  // What the off rules would have sent: changes found by a re-check that no message carried.
  const unsent = off.some((r) => r.kind === 'any_change')
    ? changes.filter((c) => !c.notified && c.previous_check_id !== null && c.subject === 'content')
    : [];
  const quiet = off.length
    ? [
        off.length === 1 && off[0] === rules.at(-1)
          ? COPY.quietLast
          : COPY.quietNamed(off.map(label)),
        ...unsent.map((c) => COPY.unsent(weekday(c.detected_at, zone), c.summary)),
      ]
    : [];

  return {
    shell: accountShellView(v, 'Alerts'),
    header: { title: COPY.title, line, verdicts: [...new Set(open.flatMap(verdictsOf))], actions },
    fired: {
      title: COPY.firedTitle,
      sub: COPY.firedSub(ALERTS_SENDER),
      rows,
      messages,
      foot: messages.length ? COPY.firedFoot(emailClauses, slackOnly) : null,
      empty: messages.length ? null : COPY.firedEmpty,
    },
    channels: {
      title: COPY.channelsTitle,
      rows: channels,
      foot: [COPY.slackIsPro, trial ? COPY.trialFoot(TRIAL_DAYS) : COPY.freeFoot].join(' '),
    },
    rules: {
      title: COPY.rulesTitle,
      rows: rules.map((r) => ({
        key: r.id,
        label: label(r),
        verdicts: r.kind === 'crawler_blocked' ? BLOCKING_VERDICTS : [],
        on: r.enabled,
        toggle: routeAction('accountAlertRules', label(r), {}, { fields: { rule: r.id } }),
      })),
      foot: rules.length ? [COPY.override, ...quiet].join(' ') : null,
      empty: rules.length ? null : COPY.rulesEmpty,
    },
  };
}
