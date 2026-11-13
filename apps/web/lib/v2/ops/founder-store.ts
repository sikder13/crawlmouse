/**
 * What the founder notices read and write (CC-33 D3), over the service-role client: the claim, the
 * overflow take and the digest counts (migration 20261115000001 section C), and the reads a notice is
 * built from. Answers are parsed with zod; a database error throws, so the caller's step is retried.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  DIGEST_FIGURES,
  type DigestCounts,
  type DigestFigure,
} from '../mail/templates/founder-digest';
import {
  FOUNDER_EVENT_KINDS,
  STRIPE_INVOICE_STATUSES,
  type FounderEventKind,
  type FounderOverflowRow,
} from '../mail/templates/founder-event';

export type NoticeState = 'send' | 'held' | 'skipped';

export interface NoticeClaim {
  /** The notice's key, without the ledger's `founder_event:` prefix. */
  key: string;
  kind: FounderEventKind;
  accountId: string | null;
  internal: boolean;
  occurredAt: string;
  facts: Readonly<Record<string, string | number | null>>;
  now: Date;
  limit: number;
  configured: boolean;
}

/** An account as a notice names it. */
export interface NoticeAccount {
  internal: boolean;
  subscriptionId: string | null;
  /** The active owner's address, or null when the account has none. */
  ownerEmail: string | null;
  /** The account's first site not removed, or null. */
  host: string | null;
}

export interface FounderStore {
  claim(c: NoticeClaim): Promise<NoticeState>;
  takeOverflow(key: string, rows: number): Promise<{ total: number; rows: FounderOverflowRow[] }>;
  digestCounts(from: string, to: string): Promise<DigestCounts>;
  account(accountId: string): Promise<NoticeAccount | null>;
  /**
   * Users created at or after `since` whose sign-up is not announced, `limit` of them in the
   * rotation's `turn` (founder_signups_unannounced).
   */
  unannouncedUsers(
    since: string,
    limit: number,
    turn: number,
  ): Promise<{ userId: string; accountId: string | null; createdAt: string }[]>;
  /** Agency accounts created at or after `since`. */
  agencyAccounts(since: string): Promise<{ accountId: string; createdAt: string }[]>;
  /** Subscriptions canceled at or after `since`. */
  cancellations(
    since: string,
  ): Promise<
    { subscriptionId: string; accountId: string; plan: 'pro' | 'agency'; canceledAt: string }[]
  >;
}

/** Postgres's timestamptz as PostgREST and PGlite give it, as an ISO instant. */
const instant = z.string().transform((s, ctx) => {
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) {
    ctx.addIssue({ code: 'custom', message: 'not a time' });
    return z.NEVER;
  }
  return new Date(ms).toISOString();
});

const StateSchema = z.enum(['send', 'held', 'skipped']);
const OverflowSchema = z.strictObject({
  total: z.int().min(0),
  rows: z.array(
    z.strictObject({
      kind: z.enum(FOUNDER_EVENT_KINDS),
      account_id: z.string().nullable(),
      internal: z.boolean(),
      occurred_at: z.string(),
      invoice: z.enum([...STRIPE_INVOICE_STATUSES, 'not_given', 'not_read']).nullable(),
    }),
  ),
});
const CountsSchema = z.strictObject(
  Object.fromEntries(DIGEST_FIGURES.map(([k]) => [k, z.int().min(0)])) as Record<
    DigestFigure,
    z.ZodInt
  >,
);

function fail(what: string, error: { code?: string } | null): never {
  throw new Error(`${what}: ${error?.code ?? 'error'}`);
}

export function supabaseFounderStore(sb: SupabaseClient): FounderStore {
  return {
    async claim(c) {
      const { data, error } = await sb.rpc('claim_founder_notice', {
        p_key: c.key,
        p_kind: c.kind,
        p_account: c.accountId,
        p_internal: c.internal,
        p_occurred: c.occurredAt,
        p_facts: c.facts,
        p_now: c.now.toISOString(),
        p_limit: c.limit,
        p_configured: c.configured,
      });
      if (error) fail('claim_founder_notice', error);
      return StateSchema.parse(data);
    },
    async takeOverflow(key, rows) {
      const { data, error } = await sb.rpc('take_founder_overflow', { p_key: key, p_rows: rows });
      if (error) fail('take_founder_overflow', error);
      const t = OverflowSchema.parse(data);
      return {
        total: t.total,
        rows: t.rows.map((r) => ({
          kind: r.kind,
          accountId: r.account_id,
          internal: r.internal,
          invoice: r.invoice,
        })),
      };
    },
    async digestCounts(from, to) {
      const { data, error } = await sb.rpc('founder_digest_counts', { p_from: from, p_to: to });
      if (error) fail('founder_digest_counts', error);
      return CountsSchema.parse(data);
    },
    async account(accountId) {
      const { data: a, error } = await sb
        .from('accounts')
        .select('internal, current_subscription_id')
        .eq('id', accountId)
        .maybeSingle();
      if (error) fail('accounts', error);
      if (a === null) return null;
      const { data: seat, error: seatError } = await sb
        .from('seats')
        .select('user_id')
        .eq('account_id', accountId)
        .eq('role', 'owner')
        .eq('status', 'active')
        .maybeSingle();
      if (seatError) fail('seats', seatError);
      let ownerEmail: string | null = null;
      if (seat?.user_id) {
        const { data: u, error: userError } = await sb
          .from('users')
          .select('email')
          .eq('id', seat.user_id)
          .maybeSingle();
        if (userError) fail('users', userError);
        ownerEmail = (u?.email as string | undefined) ?? null;
      }
      const { data: sites, error: siteError } = await sb
        .from('sites')
        .select('host')
        .eq('account_id', accountId)
        .is('removed_at', null)
        .order('created_at', { ascending: true })
        .limit(1);
      if (siteError) fail('sites', siteError);
      const row = z
        .object({
          internal: z.boolean(),
          current_subscription_id: z.string().nullable(),
        })
        .parse(a);
      return {
        internal: row.internal,
        subscriptionId: row.current_subscription_id,
        ownerEmail,
        host: (sites?.[0]?.host as string | undefined) ?? null,
      };
    },
    async unannouncedUsers(since, limit, turn) {
      const { data, error } = await sb.rpc('founder_signups_unannounced', {
        p_since: since,
        p_limit: limit,
        p_turn: turn,
      });
      if (error) fail('founder_signups_unannounced', error);
      return z
        .array(
          z.object({ user_id: z.string(), account_id: z.string().nullable(), created_at: instant }),
        )
        .parse(data)
        .map((r) => ({ userId: r.user_id, accountId: r.account_id, createdAt: r.created_at }));
    },
    async agencyAccounts(since) {
      const { data, error } = await sb
        .from('accounts')
        .select('id, created_at')
        .eq('kind', 'agency')
        .gte('created_at', since)
        .order('created_at', { ascending: true });
      if (error) fail('accounts', error);
      return z
        .array(z.object({ id: z.string(), created_at: instant }))
        .parse(data)
        .map((r) => ({ accountId: r.id, createdAt: r.created_at }));
    },
    async cancellations(since) {
      const { data, error } = await sb
        .from('subscriptions')
        .select('id, account_id, plan, canceled_at')
        .gte('canceled_at', since)
        .order('canceled_at', { ascending: true });
      if (error) fail('subscriptions', error);
      return z
        .array(
          z.object({
            id: z.string(),
            account_id: z.string(),
            plan: z.enum(['pro', 'agency']),
            canceled_at: instant,
          }),
        )
        .parse(data)
        .map((r) => ({
          subscriptionId: r.id,
          accountId: r.account_id,
          plan: r.plan,
          canceledAt: r.canceled_at,
        }));
    },
  };
}
