/**
 * The support console's screens as plain values (CC-33 D2), from the store's rows: no clock, no
 * request. A time is written as UTC to the minute. The Stripe customer id is a link to Stripe's
 * dashboard only when it has a customer id's shape, so no other stored value becomes a link.
 */
import type { Route } from 'next';
import type { AccountRow, Dossier, DossierSection } from './console-store';

/** StatusPill's states, named here so this module imports nothing of the v2 components. */
export type Pill = 'ok' | 'warn' | 'bad' | 'unverified' | 'neutral';

const NONE = '—';

/** `2026-11-12 08:01 UTC`, or a dash for no time. */
export function when(iso: string | null): string {
  if (iso === null) return NONE;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NONE;
  const two = (n: number) => String(n).padStart(2, '0');
  const day = `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
  return `${day} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC`;
}

const CUSTOMER = /^cus_[A-Za-z0-9]+$/;

export function stripeLink(id: string | null): { id: string; href: string | null } | null {
  if (id === null) return null;
  return { id, href: CUSTOMER.test(id) ? `https://dashboard.stripe.com/customers/${id}` : null };
}

/** An account's name, or its id's first group for one with none. */
const nameOf = (a: Pick<AccountRow, 'id' | 'name'>) => a.name ?? `Account ${a.id.split('-')[0]}`;

const CHECK_PILL: Record<string, Pill> = { finished: 'ok', partial: 'warn', failed: 'bad' };
const MAIL_PILL: Record<string, Pill> = { sent: 'ok', failed: 'bad', suppressed: 'warn' };

export interface AccountView {
  id: string;
  heading: string;
  internal: boolean;
  deleted: boolean;
  facts: { label: string; value: string }[];
  stripe: { id: string; href: string | null } | null;
  history: { state: string; since: string }[];
  seats: {
    key: string;
    email: string;
    role: string;
    status: string;
    since: string;
    /** The seat's user, when a sign-in link may be re-sent to them: an active seat only. */
    resendUserId: string | null;
  }[];
  sites: { key: string; host: string; state: string }[];
  checks: {
    key: string;
    id: string;
    host: string;
    trigger: string;
    status: string;
    pill: Pill;
    failure: string;
    queued: string;
    started: string;
    finished: string;
    /** A failed check of a site that is kept, not paused and not removed. */
    rerun: boolean;
  }[];
  mail: {
    key: string;
    kind: string;
    status: string;
    pill: Pill;
    attempts: string;
    error: string;
    claimed: string;
    sent: string;
  }[];
  rules: {
    key: string;
    kind: string;
    scope: string;
    enabled: string;
    channels: string;
    lastFired: string;
  }[];
  alerts: {
    key: string;
    sent: string;
    kind: string;
    site: string;
    channel: string;
    status: string;
    reason: string;
  }[];
  fixes: { key: string; number: string; type: string; status: string; host: string }[];
  /** How many rows of each list the page does not show: the list's count less the rows read. */
  withheld: Record<DossierSection, number>;
  /** A line under a list that leaves rows out, when other lists are read from the rows it shows. */
  notes: { sites: string | null; rules: string | null };
}

const SECTIONS: readonly DossierSection[] = [
  'seats',
  'sites',
  'checks',
  'mail',
  'rules',
  'alerts',
  'fixes',
];

function historyOf(raw: unknown): { state: string; since: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((e: unknown) => {
    if (typeof e !== 'object' || e === null) return [];
    const { state, since } = e as { state?: unknown; since?: unknown };
    return typeof state === 'string'
      ? [{ state, since: when(typeof since === 'string' ? since : null) }]
      : [];
  });
}

export function accountView(d: Dossier): AccountView {
  const a = d.account;
  const withheld = Object.fromEntries(
    SECTIONS.map((k) => [k, Math.max(0, d.totals[k] - d[k].length)]),
  ) as Record<DossierSection, number>;
  const sites = new Map(d.sites.map((s) => [s.id, s]));
  const hostOf = (siteId: string | null) =>
    siteId === null ? 'Account' : (sites.get(siteId)?.host ?? siteId);
  const rules = new Map(d.rules.map((r) => [r.id, r]));
  return {
    id: a.id,
    heading: nameOf(a),
    internal: a.internal,
    deleted: a.deleted_at !== null,
    facts: [
      { label: 'Account id', value: a.id },
      { label: 'Kind', value: a.kind },
      { label: 'State', value: a.state },
      { label: 'Tier', value: a.tier },
      { label: 'Trial ends', value: when(a.trial_ends_at) },
      { label: 'Past due since', value: when(a.past_due_since) },
      { label: 'Created', value: when(a.created_at) },
      { label: 'Deleted', value: when(a.deleted_at) },
    ],
    stripe: stripeLink(a.stripe_customer_id),
    history: historyOf(a.state_history),
    seats: d.seats.map((s) => ({
      key: s.id,
      email: (s.user_id !== null && d.emails[s.user_id]) || NONE,
      role: s.role,
      status: s.status,
      since: when(s.removed_at ?? s.accepted_at),
      resendUserId: s.status === 'active' && s.user_id !== null ? s.user_id : null,
    })),
    sites: d.sites.map((s) => ({
      key: s.id,
      host: s.host,
      state:
        s.removed_at !== null
          ? `removed ${when(s.removed_at)}`
          : s.paused_reason !== null
            ? `paused (${s.paused_reason})`
            : 'active',
    })),
    checks: d.checks.map((c) => {
      const site = sites.get(c.site_id);
      return {
        key: c.id,
        id: c.id,
        host: hostOf(c.site_id),
        trigger: c.trigger,
        status: c.status,
        pill: CHECK_PILL[c.status] ?? 'neutral',
        failure: c.failure_reason ?? NONE,
        queued: when(c.queued_at),
        started: when(c.started_at),
        finished: when(c.finished_at),
        rerun:
          c.status === 'failed' &&
          site !== undefined &&
          site.removed_at === null &&
          site.paused_reason === null,
      };
    }),
    mail: d.mail.map((m) => ({
      key: m.id,
      kind: m.kind,
      status: m.status,
      pill: MAIL_PILL[m.status] ?? 'neutral',
      attempts: String(m.attempts),
      error: m.error_code ?? NONE,
      claimed: when(m.claimed_at),
      sent: when(m.sent_at),
    })),
    rules: d.rules.map((r) => ({
      key: r.id,
      kind: r.kind,
      scope: hostOf(r.site_id),
      enabled: r.enabled ? 'on' : 'off',
      channels: r.channels.join(', '),
      lastFired: when(r.last_fired_at),
    })),
    alerts: d.alerts.map((e) => ({
      key: e.id,
      sent: when(e.sent_at),
      kind: rules.get(e.rule_id)?.kind ?? NONE,
      site: hostOf(e.site_id),
      channel: e.channel,
      status: e.status,
      reason: e.reason ?? NONE,
    })),
    fixes: d.fixes.map((f) => ({
      key: f.id,
      number: String(f.number),
      type: f.type,
      status: f.status,
      host: hostOf(f.site_id),
    })),
    withheld,
    notes: {
      sites:
        withheld.sites > 0 ? 'The checks and open fixes below are those of the sites shown.' : null,
      rules: withheld.rules > 0 ? 'The alerts below are those of the rules shown.' : null,
    },
  };
}

export interface ResultRow {
  id: string;
  /** A typed route: the build checks `<Link href>` against the app's routes. */
  href: Route;
  name: string;
  kind: string;
  state: string;
  tier: string;
  internal: boolean;
  deleted: boolean;
}

/** The accounts a search found, in the order of `ids` (an id with no row is left out). */
export function resultsView(ids: readonly string[], rows: readonly AccountRow[]): ResultRow[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => {
    const a = byId.get(id);
    return a === undefined
      ? []
      : [
          {
            id: a.id,
            href: `/internal/accounts/${a.id}` as Route,
            name: nameOf(a),
            kind: a.kind,
            state: a.state,
            tier: a.tier,
            internal: a.internal,
            deleted: a.deleted_at !== null,
          },
        ];
  });
}
