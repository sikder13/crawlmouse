/**
 * What a signed-in reader's account holds at a moment: the account screens' one reading of a
 * fixture. `viewAt` keeps the viewer's own records and drops everything recorded after `now`, so a
 * screen viewed on day 0 cannot show a check, change or fix that did not exist yet (D1, D2).
 */
import type { CardsOnFile } from '../account/card';
import {
  instant,
  type Account,
  type Check,
  type Fix,
  type FixtureDataset,
  type Seat,
  type Site,
} from '@crawlmouse/types/v2';
import {
  GATES,
  effectiveTier,
  type EntitlementClock,
  type Tier,
  type TierGates,
} from '../../entitlement-v2';
import { TRIAL_DAYS } from '../copy/account';

/**
 * The records the account screens read: a contract fixture, or an account's rows read back as the
 * same collections (lib/v2/account/dataset.ts), which say they were measured.
 */
export type AccountDataset = Omit<FixtureDataset, 'provenance'> & {
  provenance: 'fixture' | 'measured';
} & CardsOnFile;

export interface Viewer {
  /** The account whose screens these are. */
  accountId: string;
  /**
   * The reader's own seat, whose theme the frame wears. A preview names none and reads as the
   * account's owner.
   */
  seatId?: string;
  /** The reader's "now", an ISO instant. */
  now: string;
  /**
   * A preview's stand-in account, for a fixture that has none (clean-site). The preview registry
   * states each one; nothing reads it outside a preview.
   */
  account?: Account;
  /** Unkept audits the stand-in account holds as its sites, by site id. */
  adopt?: readonly string[];
}

/** A check queued by now that has not ended by now, and what it was doing then. */
export interface InFlight {
  siteId: string;
  status: 'queued' | 'running' | 'deferred';
}

/**
 * Fields viewAt keeps as the fixture's `as_of` has them, because the contract records no date for a
 * change to them. The spec lists these; day 0 shows them as they stand at as_of.
 */
export const NOT_ROLLED_BACK = [
  'accounts[].integrations',
  'accounts[].limits',
  'accounts[].email_prefs',
  'accounts[].card_last4',
  'accounts[].renews_at',
  'seats[].theme',
  'seats[].accepted_at',
  'sites[].schedule',
  'sites[].paused',
  'sites[].competitor_hosts',
  'sites[].slack_channel',
  'fixes[].effect',
  'fixes[].before_after',
  'fixes[].last_measured_check_id (at day 0 it can name a check that has not run yet)',
  'fixes[].rank (an open fix read before it resolved sorts after the ranked ones)',
  'alert_rules[].enabled',
  'alert_rules[].threshold_points',
] as const;

export interface AccountView {
  /**
   * The account's own records, none of them later than `now`. Typed as the shared readers take a
   * dataset (`fixesAsOf` and `findCheck` in lib/v2/fixtures.ts, `freeFixes` in view/free-fixes.ts),
   * which read its collections only; `provenance` is the input's own, "measured" for an account read
   * back from its rows.
   */
  d: FixtureDataset;
  account: Account;
  /** The reader's seat (Viewer.seatId), or null for a preview, which reads as the owner. */
  seatId: string | null;
  now: string;
  /** The account's tier at `now` (lib/entitlement-v2.ts `effectiveTier`). */
  tier: Tier;
  gates: Readonly<TierGates>;
  inFlight: InFlight[];
  /**
   * Whether the account has a card on file. True where `account.card_last4` holds the digits, and
   * where the dataset's `cardsOnFile` names the account for a reader the digits are withheld from.
   */
  cardOnFile: boolean;
}

export const PLAN_NAMES: Record<Tier, string> = { free: 'Free', pro: 'Pro', agency: 'Agency' };

const TIER_OF_STATE = {
  free: 'free',
  pro_trial: 'pro',
  pro: 'pro',
  agency_trial: 'agency',
  agency: 'agency',
} as const satisfies Record<Exclude<Account['state'], 'past_due'>, Tier>;

const RESULT = new Set<Check['status']>(['finished', 'partial']);

const at = (ts: string) => instant(ts);

function accountOf(d: AccountDataset, viewer: Pick<Viewer, 'accountId' | 'account'>): Account {
  const a = viewer.account ?? d.accounts.find((x) => x.id === viewer.accountId);
  if (!a || a.id !== viewer.accountId) throw new Error(`No account ${viewer.accountId}`);
  return a;
}

/**
 * The entitlement clock the contract's account carries. The contract has no tier column: a
 * past_due account's tier is the state it was in before, and a Pro trial with no card on file is
 * the no-card variant (ARCH-2 §3.1); the contract records no other sign of the variant.
 */
function clockOf(a: Account, cardOnFile: boolean): EntitlementClock {
  const last = a.state_history.at(-1)!;
  const before = a.state_history.filter((h) => h.state !== 'past_due').at(-1);
  const pastDue = a.state === 'past_due';
  const pastDueTier =
    pastDue && before ? TIER_OF_STATE[before.state as keyof typeof TIER_OF_STATE] : null;
  if (pastDueTier === 'free') throw new Error(`Account ${a.id} is past_due after a free state`);
  return {
    state: a.state,
    tier: pastDueTier ?? TIER_OF_STATE[a.state as keyof typeof TIER_OF_STATE] ?? 'free',
    pastDueTier,
    pastDueSince: pastDue ? new Date(last.since) : null,
    trialVariant: a.state === 'pro_trial' ? (cardOnFile ? 'card_required' : 'no_card') : null,
    trialEndsAt: a.trial_ends_at ? new Date(a.trial_ends_at) : null,
  };
}

/** The account as it stood at `t`: its history up to then, and the fields that history decides. */
function accountAt(a: Account, t: number): Account {
  const history = a.state_history.filter((h) => at(h.since) <= t);
  const last = history.at(-1);
  if (!last) throw new Error(`Account ${a.id} did not exist at ${new Date(t).toISOString()}`);
  const trial = last.state === 'pro_trial' || last.state === 'agency_trial';
  // The account records only its current trial's end; a trial read later in the history ends
  // TRIAL_DAYS after it began (ARCH-2 §3.1: both trials last 14 days).
  const current = history.length === a.state_history.length;
  const ends = current
    ? a.trial_ends_at
    : new Date(at(last.since) + TRIAL_DAYS * 86_400_000).toISOString();
  return {
    ...a,
    state: last.state,
    state_history: history,
    trial_ends_at: trial ? ends : null,
    agency_trial_consent: history.some((h) => h.state === 'agency_trial')
      ? a.agency_trial_consent
      : null,
  };
}

/** The first moment the account's dashboard can be read: it exists and its first audit is done. */
export function firstRunNow(d: AccountDataset, viewer: Omit<Viewer, 'now'>): string {
  const a = accountOf(d, viewer);
  const sites = new Set(
    d.sites.filter((s) => s.account_id === a.id || viewer.adopt?.includes(s.id)).map((s) => s.id),
  );
  const firstResult = d.checks
    .filter((c) => sites.has(c.site_id) && RESULT.has(c.status) && c.finished_at)
    .map((c) => at(c.finished_at!))
    .sort((x, y) => x - y)[0];
  const begins = at(a.state_history[0]!.since);
  const t = Math.max(begins, firstResult ?? begins);
  return t === begins ? a.state_history[0]!.since : new Date(t).toISOString();
}

/** The status a fix's last event leaves it in (packages/types/src/v2/fix.ts: status follows events). */
const STATUS_AFTER: Record<FixtureDataset['fix_events'][number]['kind'], Fix['status']> = {
  marked_done: 'marked_done',
  verified: 'verified_resolved',
  unable_to_verify: 'unable_to_verify',
  reopened: 'reopened',
};

/**
 * What the last measurement found, when a fix is read before its later events. Nothing records it,
 * so it is the one value the contract allows for that status (LAST_STATE_FOR_STATUS); marked_done
 * allows any and keeps the fix's own.
 */
const LAST_STATE_AFTER: Partial<Record<Fix['status'], Fix['last_state']>> = {
  open: 'detected',
  reopened: 'detected',
  verified_resolved: 'not_detected',
  unable_to_verify: 'indeterminate',
};

/** A fix's status at `t`, from its events up to then (the contract says status follows them). */
function fixAt(
  f: FixtureDataset['fixes'][number],
  d: AccountDataset,
  t: number,
  rankAfter: number,
) {
  const events = d.fix_events.filter((e) => e.fix_id === f.id);
  if (!events.length) return f;
  const last = events
    .filter((e) => at(e.at) <= t)
    .sort((x, y) => at(x.at) - at(y.at))
    .at(-1);
  const status: Fix['status'] = last ? STATUS_AFTER[last.kind] : 'open';
  if (status === f.status) return f;
  const unresolved = status !== 'verified_resolved';
  return {
    ...f,
    status,
    // What the measurement found before the later events is not recorded: an open fix was detected.
    last_state: LAST_STATE_AFTER[status] ?? f.last_state,
    // A resolved fix carries no rank; earlier, while open, it sorts after the site's ranked fixes,
    // each at its own place (by number, which is unique within a site).
    rank: unresolved ? (f.rank ?? rankAfter + f.number) : null,
  };
}

export function viewAt(d: AccountDataset, viewer: Viewer): AccountView {
  const t = at(viewer.now);
  const account = accountAt(accountOf(d, viewer), t);
  const adopt = new Set(viewer.adopt ?? []);

  const sites = d.sites
    .filter((s) => (s.account_id === account.id || adopt.has(s.id)) && at(s.created_at) <= t)
    .map((s) => (adopt.has(s.id) ? { ...s, account_id: account.id } : s));
  const siteIds = new Set(sites.map((s) => s.id));
  const ours = d.checks.filter((c) => siteIds.has(c.site_id) && at(c.queued_at) <= t);
  const ended = (c: Check) => c.finished_at !== null && at(c.finished_at) <= t;
  const checks = ours.filter(ended);
  const checkIds = new Set(checks.map((c) => c.id));

  const inFlight: InFlight[] = ours
    .filter((c) => !ended(c))
    .sort((x, y) => at(x.queued_at) - at(y.queued_at))
    .map((c) => ({
      siteId: c.site_id,
      status:
        c.status === 'deferred'
          ? 'deferred'
          : c.started_at && at(c.started_at) <= t
            ? 'running'
            : 'queued',
    }));

  const ranked = new Map<string, number>();
  for (const f of d.fixes) {
    if (f.rank !== null) ranked.set(f.site_id, Math.max(ranked.get(f.site_id) ?? 0, f.rank));
  }
  const fixes = d.fixes
    .filter((f) => checkIds.has(f.first_seen_check_id))
    .map((f) => fixAt(f, d, t, (ranked.get(f.site_id) ?? 0) + 1));
  const fixIds = new Set(fixes.map((f) => f.id));
  const reports = d.reports.filter(
    (r) =>
      r.account_id === account.id &&
      at(r.created_at) <= t &&
      siteIds.has(r.site_id) &&
      r.covers_check_ids.every((id) => checkIds.has(id)),
  );
  const reportIds = new Set(reports.map((r) => r.id));

  const scoped: AccountDataset = {
    ...d,
    as_of: viewer.now,
    accounts: [account],
    seats: d.seats.filter((s) => s.account_id === account.id && at(s.invited_at) <= t),
    sites,
    checks,
    page_results: d.page_results.filter((p) => checkIds.has(p.check_id)),
    link_edges: d.link_edges.filter((e) => checkIds.has(e.check_id)),
    access_tests: d.access_tests.filter((a) => checkIds.has(a.check_id)),
    fixes,
    fix_events: d.fix_events.filter((e) => fixIds.has(e.fix_id) && at(e.at) <= t),
    changes: d.changes.filter((c) => checkIds.has(c.check_id) && at(c.detected_at) <= t),
    alert_rules: d.alert_rules
      .filter((r) => r.account_id === account.id && (r.site_id === null || siteIds.has(r.site_id)))
      .map((r) =>
        r.last_fired_at && at(r.last_fired_at) > t
          ? { ...r, last_fired_at: null, last_fired_check_id: null }
          : r,
      ),
    reports,
    usage_events: d.usage_events.filter(
      (u) =>
        u.account_id === account.id &&
        at(u.occurred_at) <= t &&
        (u.check_id === null || checkIds.has(u.check_id)) &&
        (u.report_id === null || reportIds.has(u.report_id)),
    ),
    withheld: d.withheld.filter((w) => checkIds.has(w.check_id)),
  };

  // A card on file, whether or not this reader is given its digits (CC-37 Q25).
  const cardOnFile = account.card_last4 !== null || (d.cardsOnFile ?? []).includes(account.id);
  const tier = effectiveTier(clockOf(account, cardOnFile), new Date(t));
  return {
    d: scoped as FixtureDataset,
    account,
    seatId: viewer.seatId ?? null,
    now: viewer.now,
    tier,
    gates: GATES[tier],
    inFlight,
    cardOnFile,
  };
}

/**
 * The reader's seat: `seatId`'s, or, on a preview, which names none, the owner's. Null when the
 * records hold no such seat.
 */
export function readerSeat(v: AccountView): Seat | null {
  return v.d.seats.find((s) => (v.seatId ? s.id === v.seatId : s.role === 'owner')) ?? null;
}

/**
 * The reader's role. A preview names no seat and reads as the owner, whether or not its fixture
 * holds an owner seat (clean-site's stand-in account holds none); a live reader is their seat's.
 */
export function readerRole(v: AccountView): Seat['role'] | null {
  return v.seatId === null ? 'owner' : (readerSeat(v)?.role ?? null);
}

/** Whether the reader may run the account's sites: add, edit and remove them (questions.md Q12). */
export const runsSites = (v: AccountView): boolean => {
  const role = readerRole(v);
  return role === 'owner' || role === 'account_manager';
};

/** Whether the reader may add a site: runs sites, and from a seat that covers every client. */
export const addsSites = (v: AccountView): boolean =>
  runsSites(v) && (v.seatId === null || readerSeat(v)?.client_scope === 'all');

/** The oldest site that is not another site's staging copy: the one Free keeps (ARCH-2 §3.2). */
export function primarySite(v: AccountView): Site {
  const s = v.d.sites
    .filter((x) => x.staging_of_site_id === null)
    .sort((x, y) => at(x.created_at) - at(y.created_at) || x.id.localeCompare(y.id))[0];
  if (!s) throw new Error(`Account ${v.account.id} has no site at ${v.now}`);
  return s;
}

/** A site's checks that ended with a result, oldest first. */
export function resultChecks(v: AccountView, siteId: string): Check[] {
  return v.d.checks
    .filter((c) => c.site_id === siteId && RESULT.has(c.status))
    .sort((x, y) => at(x.finished_at!) - at(y.finished_at!));
}

/** The sites that hold a slot: staging and competitor copies do not (ARCH-2 §2.5, Q10). */
export const primarySites = (v: AccountView) =>
  v.d.sites.filter((s) => s.staging_of_site_id === null);
