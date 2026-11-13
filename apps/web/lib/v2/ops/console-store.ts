/**
 * The support console's reads and its record (CC-33 D2), over the service-role client. A page or
 * route reaches it through `consoleStore(proof)`, which takes the proof `requireOperator` answered;
 * `supabaseConsoleStore` takes the client itself, for tests.
 *
 * What it reads, by table and column (migrations 001, 003, 028 and 20261115000001): the account's
 * row; its seats, with `users.email` for each seat's user; its sites; the last 20 checks across those
 * sites by `queued_at`; its mail ledger (`email_sends`: kind, status, attempts, error_code, claimed_at,
 * sent_at, and not `address_hash`); its alert rules and their last 20 events; and its sites' open and
 * reopened fixes. Writes go through `operator_log` and `operator_finish` only.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { consoleAdmin, type OperatorProof } from './operator';
import type { SearchQuery } from './search';

/** How many accounts a search answers at most. */
export const SEARCH_RESULTS_MAX = 20;
/** How many checks, and how many alert events, an account page shows. */
export const RECENT_MAX = 20;
/** How many mail ledger rows an account page shows. */
export const MAIL_MAX = 50;

/** What a search was, as the record names it: an id resolves to the kind of row it named. */
export type ResolvedKind =
  | 'account_id'
  | 'check_id'
  | 'id'
  | 'stripe_customer'
  | 'email'
  | 'host'
  | 'none';

export interface AccountRow {
  id: string;
  name: string | null;
  kind: string;
  state: string;
  tier: string;
  trial_ends_at: string | null;
  past_due_since: string | null;
  state_history: unknown;
  stripe_customer_id: string | null;
  internal: boolean;
  created_at: string;
  deleted_at: string | null;
}

export interface SeatRow {
  id: string;
  user_id: string | null;
  role: string;
  status: string;
  accepted_at: string | null;
  removed_at: string | null;
}

export interface SiteRow {
  id: string;
  host: string;
  paused_reason: string | null;
  removed_at: string | null;
}

export interface CheckRow {
  id: string;
  site_id: string;
  status: string;
  trigger: string;
  failure_reason: string | null;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface MailRow {
  id: string;
  kind: string;
  status: string;
  attempts: number;
  error_code: string | null;
  claimed_at: string;
  sent_at: string | null;
}

export interface RuleRow {
  id: string;
  site_id: string | null;
  kind: string;
  enabled: boolean;
  channels: string[];
  last_fired_at: string | null;
}

export interface AlertEventRow {
  id: string;
  rule_id: string;
  site_id: string;
  check_id: string;
  channel: string;
  status: string;
  reason: string | null;
  sent_at: string;
}

export interface FixRow {
  id: string;
  site_id: string;
  number: number;
  type: string;
  status: string;
}

export interface Dossier {
  account: AccountRow;
  seats: SeatRow[];
  /** `users.email` by user id, for the seats' users. */
  emails: Record<string, string>;
  sites: SiteRow[];
  checks: CheckRow[];
  mail: MailRow[];
  rules: RuleRow[];
  alerts: AlertEventRow[];
  fixes: FixRow[];
}

export interface RerunTarget {
  checkId: string;
  siteId: string;
  status: string;
  /** Null for a site no account keeps. */
  accountId: string | null;
  removedAt: string | null;
  pausedReason: string | null;
}

export type ResendOutcome = 'sent' | 'refused' | 'rate_limited' | 'failed';

export interface ConsoleStore {
  resolve(q: SearchQuery): Promise<{ kind: ResolvedKind; accountIds: string[] }>;
  summaries(accountIds: readonly string[]): Promise<AccountRow[]>;
  dossier(accountId: string): Promise<Dossier | null>;
  /** The address of the user of an active seat on the account, or null. */
  seatEmail(accountId: string, userId: string): Promise<string | null>;
  rerunTarget(checkId: string): Promise<RerunTarget | null>;
  logSearch(kind: ResolvedKind, found: number): Promise<number>;
  logView(accountId: string): Promise<number>;
  /** The re-send's row, written before the link is asked for; its outcome is set by `finish`. */
  logResend(accountId: string, userId: string, reason: string): Promise<number>;
  finish(actionId: number, outcome: ResendOutcome): Promise<boolean>;
}

const ACCOUNT_COLUMNS =
  'id, name, kind, state, tier, trial_ends_at, past_due_since, state_history, stripe_customer_id, internal, created_at, deleted_at';

type Answer<T> = { data: T | null; error: { message: string } | null };

function rows<T>(what: string, a: Answer<T[]>): T[] {
  if (a.error) throw new Error(`console read failed: ${what}: ${a.error.message}`);
  return a.data ?? [];
}

function row<T>(what: string, a: Answer<T>): T | null {
  if (a.error) throw new Error(`console read failed: ${what}: ${a.error.message}`);
  return a.data;
}

const unique = (ids: readonly (string | null)[]): string[] => [
  ...new Set(ids.filter((x): x is string => x !== null)),
];

export function supabaseConsoleStore(admin: SupabaseClient, operatorId: string): ConsoleStore {
  const accountsWhere = async (column: 'id' | 'stripe_customer_id', value: string) =>
    rows<{ id: string }>(
      `accounts by ${column}`,
      await admin.from('accounts').select('id').eq(column, value).limit(SEARCH_RESULTS_MAX),
    ).map((r) => r.id);

  async function log(
    action: 'search' | 'view_account' | 'resend_sign_in',
    account: string | null,
    target: string,
    reason: string | null,
    outcome: string | null,
  ): Promise<number> {
    const { data, error } = await admin.rpc('operator_log', {
      p_operator: operatorId,
      p_action: action,
      p_account: account,
      p_target: target,
      p_reason: reason,
      p_outcome: outcome,
    });
    if (error) throw new Error(`operator_log failed: ${error.message}`);
    return Number(data);
  }

  return {
    async resolve(q) {
      const capped = (kind: ResolvedKind, ids: readonly (string | null)[]) => ({
        kind,
        accountIds: unique(ids).filter((_, i) => i < SEARCH_RESULTS_MAX),
      });
      switch (q.kind) {
        case 'none':
          return { kind: 'none', accountIds: [] };
        case 'stripe_customer':
          return capped('stripe_customer', await accountsWhere('stripe_customer_id', q.customerId));
        case 'id': {
          const accounts = await accountsWhere('id', q.id);
          if (accounts.length > 0) return capped('account_id', accounts);
          const c = row<{ site_id: string }>(
            'checks by id',
            await admin.from('checks').select('site_id').eq('id', q.id).maybeSingle(),
          );
          if (c === null) return { kind: 'id', accountIds: [] };
          const s = row<{ account_id: string | null }>(
            'sites by id',
            await admin.from('sites').select('account_id').eq('id', c.site_id).maybeSingle(),
          );
          return capped('check_id', [s?.account_id ?? null]);
        }
        case 'email': {
          const users = rows<{ id: string; default_account_id: string | null }>(
            'users by email',
            await admin.from('users').select('id, default_account_id').eq('email', q.email),
          );
          if (users.length === 0) return { kind: 'email', accountIds: [] };
          const seats = rows<{ account_id: string }>(
            'seats by user',
            await admin
              .from('seats')
              .select('account_id')
              .in(
                'user_id',
                users.map((u) => u.id),
              ),
          );
          return capped('email', [
            ...users.map((u) => u.default_account_id),
            ...seats.map((s) => s.account_id),
          ]);
        }
        case 'host': {
          const sites = rows<{ account_id: string | null }>(
            'sites by host',
            await admin
              .from('sites')
              .select('account_id')
              .eq('host', q.host)
              .not('account_id', 'is', null),
          );
          return capped(
            'host',
            sites.map((s) => s.account_id),
          );
        }
      }
    },

    async summaries(accountIds) {
      if (accountIds.length === 0) return [];
      return rows<AccountRow>(
        'accounts',
        await admin
          .from('accounts')
          .select(ACCOUNT_COLUMNS)
          .in('id', [...accountIds]),
      );
    },

    async dossier(accountId) {
      const account = row<AccountRow>(
        'account',
        await admin.from('accounts').select(ACCOUNT_COLUMNS).eq('id', accountId).maybeSingle(),
      );
      if (account === null) return null;
      const seats = rows<SeatRow>(
        'seats',
        await admin
          .from('seats')
          .select('id, user_id, role, status, accepted_at, removed_at')
          .eq('account_id', accountId)
          .order('created_at', { ascending: true }),
      );
      const userIds = unique(seats.map((s) => s.user_id));
      const users =
        userIds.length === 0
          ? []
          : rows<{ id: string; email: string }>(
              'users',
              await admin.from('users').select('id, email').in('id', userIds),
            );
      const sites = rows<SiteRow>(
        'sites',
        await admin
          .from('sites')
          .select('id, host, paused_reason, removed_at')
          .eq('account_id', accountId)
          .order('created_at', { ascending: true }),
      );
      const siteIds = sites.map((s) => s.id);
      const checks =
        siteIds.length === 0
          ? []
          : rows<CheckRow>(
              'checks',
              await admin
                .from('checks')
                .select(
                  'id, site_id, status, trigger, failure_reason, queued_at, started_at, finished_at',
                )
                .in('site_id', siteIds)
                .order('queued_at', { ascending: false })
                .limit(RECENT_MAX),
            );
      const mail = rows<MailRow>(
        'email_sends',
        await admin
          .from('email_sends')
          .select('id, kind, status, attempts, error_code, claimed_at, sent_at')
          .eq('account_id', accountId)
          .order('claimed_at', { ascending: false })
          .limit(MAIL_MAX),
      );
      const rules = rows<RuleRow>(
        'alert_rules',
        await admin
          .from('alert_rules')
          .select('id, site_id, kind, enabled, channels, last_fired_at')
          .eq('account_id', accountId),
      );
      const alerts =
        rules.length === 0
          ? []
          : rows<AlertEventRow>(
              'alert_events',
              await admin
                .from('alert_events')
                .select('id, rule_id, site_id, check_id, channel, status, reason, sent_at')
                .in(
                  'rule_id',
                  rules.map((r) => r.id),
                )
                .order('sent_at', { ascending: false })
                .limit(RECENT_MAX),
            );
      const fixes =
        siteIds.length === 0
          ? []
          : rows<FixRow>(
              'site_fixes',
              await admin
                .from('site_fixes')
                .select('id, site_id, number, type, status')
                .in('site_id', siteIds)
                .in('status', ['open', 'reopened'])
                .order('number', { ascending: true }),
            );
      return {
        account,
        seats,
        emails: Object.fromEntries(users.map((u) => [u.id, u.email])),
        sites,
        checks,
        mail,
        rules,
        alerts,
        fixes,
      };
    },

    async seatEmail(accountId, userId) {
      const seat = row<{ user_id: string }>(
        'seat',
        await admin
          .from('seats')
          .select('user_id')
          .eq('account_id', accountId)
          .eq('user_id', userId)
          .eq('status', 'active')
          .maybeSingle(),
      );
      if (seat === null) return null;
      const user = row<{ email: string }>(
        'user',
        await admin.from('users').select('email').eq('id', userId).maybeSingle(),
      );
      return user?.email ?? null;
    },

    async rerunTarget(checkId) {
      const c = row<{ id: string; site_id: string; status: string }>(
        'check',
        await admin.from('checks').select('id, site_id, status').eq('id', checkId).maybeSingle(),
      );
      if (c === null) return null;
      const s = row<{
        account_id: string | null;
        removed_at: string | null;
        paused_reason: string | null;
      }>(
        'site',
        await admin
          .from('sites')
          .select('account_id, removed_at, paused_reason')
          .eq('id', c.site_id)
          .maybeSingle(),
      );
      return {
        checkId: c.id,
        siteId: c.site_id,
        status: c.status,
        accountId: s?.account_id ?? null,
        removedAt: s?.removed_at ?? null,
        pausedReason: s?.paused_reason ?? null,
      };
    },

    logSearch: (kind, found) => log('search', null, kind, null, String(found)),
    logView: (accountId) => log('view_account', accountId, accountId, null, null),
    logResend: (accountId, userId, reason) =>
      log('resend_sign_in', accountId, userId, reason, null),

    async finish(actionId, outcome) {
      const { data, error } = await admin.rpc('operator_finish', {
        p_id: actionId,
        p_outcome: outcome,
      });
      if (error) throw new Error(`operator_finish failed: ${error.message}`);
      return data === true;
    },
  };
}

/** The store for an operator's request: the service-role client behind their proof. */
export function consoleStore(proof: OperatorProof): ConsoleStore {
  return supabaseConsoleStore(consoleAdmin(proof), proof.userId);
}
