/**
 * What the mail handlers read and write (handlers.ts), as a port, and production's implementation
 * over the service-role client. The addresses read here are used as a send's recipient and nowhere
 * else: no method logs one, and an error names the call and Postgres's code only.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Fix } from '@crawlmouse/types/v2';
import { z } from 'zod';
import { supabaseFixesStore } from '../account/fixes-store';

export interface AccountLinkRow {
  kind: string;
  recipient: string;
}

export interface IssuedLink {
  kind: string;
  token: string;
}

/** What the trial reminder needs of an account, and its owner's sign-in address. */
export interface TrialAccount {
  state: string;
  trialVariant: 'no_card' | 'card_required' | null;
  trialEndsAt: string | null;
  timezone: string;
  remind: boolean;
  /** `deleted_at` or `deletion_confirmed_at` set: the account is marked for deletion. */
  marked: boolean;
  ownerEmail: string | null;
}

export interface NotifyCheck {
  status: string;
  notifyEmail: string | null;
  host: string;
  accountId: string | null;
}

export interface FixEmailRequest {
  toEmail: string;
  sentAt: string | null;
  accountId: string;
  host: string;
  fix: Fix;
}

export interface FinishedCheck {
  trigger: string;
  status: string;
  accountId: string | null;
}

export interface MailStore {
  /** `account_link_recipient`: who a link's email goes to, without minting it; null when it cannot be used. */
  accountLinkRecipient(tokenId: string): Promise<AccountLinkRow | null>;
  /** `issue_account_link`: mints the link (and a deletion's paired restore link). Never logged or stored. */
  issueAccountLink(tokenId: string): Promise<IssuedLink[]>;
  trialAccount(accountId: string): Promise<TrialAccount | null>;
  notifyCheck(checkId: string): Promise<NotifyCheck | null>;
  fixEmailRequest(requestId: string): Promise<FixEmailRequest | null>;
  /** Sets `fix_email_requests.sent_at` when it is not set. */
  markFixEmailSent(requestId: string, at: Date): Promise<void>;
  /** A check's trigger, status and owner, read from the database (the event's account can be null). */
  finishedCheck(checkId: string): Promise<FinishedCheck | null>;
}

const fail = (what: string, error: { code?: string } | null): never => {
  throw new Error(`mail store: ${what}: ${error?.code ?? 'error'}`);
};

const LinkRows = z.array(z.object({ kind: z.string(), recipient: z.string() }));
const Issued = z.array(z.object({ kind: z.string(), token: z.string() }));
const AccountRow = z.object({
  state: z.string(),
  trial_variant: z.enum(['no_card', 'card_required']).nullable(),
  trial_ends_at: z.string().nullable(),
  timezone: z.string(),
  email_trial_reminder: z.boolean(),
  deleted_at: z.string().nullable(),
  deletion_confirmed_at: z.string().nullable(),
});
const CheckRow = z.object({
  status: z.string(),
  trigger: z.string(),
  notify_email: z.string().nullable(),
  site_id: z.string(),
});
const SiteRow = z.object({ host: z.string(), account_id: z.string().nullable() });
const RequestRow = z.object({
  to_email: z.string(),
  sent_at: z.string().nullable(),
  account_id: z.string(),
  fix_id: z.string(),
});

export function supabaseMailStore(sb: SupabaseClient): MailStore {
  const site = async (siteId: string) => {
    const r = await sb.from('sites').select('host, account_id').eq('id', siteId).maybeSingle();
    if (r.error) fail('sites', r.error);
    return r.data === null ? null : SiteRow.parse(r.data);
  };
  const check = async (checkId: string) => {
    const r = await sb
      .from('checks')
      .select('status, trigger, notify_email, site_id')
      .eq('id', checkId)
      .maybeSingle();
    if (r.error) fail('checks', r.error);
    return r.data === null ? null : CheckRow.parse(r.data);
  };

  return {
    async accountLinkRecipient(tokenId) {
      const r = await sb.rpc('account_link_recipient', { p_token: tokenId });
      if (r.error) fail('account_link_recipient', r.error);
      return LinkRows.parse(r.data ?? [])[0] ?? null;
    },

    async issueAccountLink(tokenId) {
      const r = await sb.rpc('issue_account_link', { p_token: tokenId });
      if (r.error) fail('issue_account_link', r.error);
      return Issued.parse(r.data ?? []).map(({ kind, token }) => ({ kind, token }));
    },

    async trialAccount(accountId) {
      const a = await sb
        .from('accounts')
        .select(
          'state, trial_variant, trial_ends_at, timezone, email_trial_reminder, deleted_at, deletion_confirmed_at',
        )
        .eq('id', accountId)
        .maybeSingle();
      if (a.error) fail('accounts', a.error);
      if (a.data === null) return null;
      const row = AccountRow.parse(a.data);
      const owner = await sb
        .from('seats')
        .select('user_id')
        .eq('account_id', accountId)
        .eq('role', 'owner')
        .eq('status', 'active')
        .maybeSingle();
      if (owner.error) fail('seats', owner.error);
      const userId = z.object({ user_id: z.string() }).nullable().parse(owner.data)?.user_id;
      let ownerEmail: string | null = null;
      if (userId !== undefined) {
        const u = await sb.from('users').select('email').eq('id', userId).maybeSingle();
        if (u.error) fail('users', u.error);
        ownerEmail = z.object({ email: z.string() }).nullable().parse(u.data)?.email ?? null;
      }
      return {
        state: row.state,
        trialVariant: row.trial_variant,
        trialEndsAt: row.trial_ends_at,
        timezone: row.timezone,
        remind: row.email_trial_reminder,
        marked: row.deleted_at !== null || row.deletion_confirmed_at !== null,
        ownerEmail,
      };
    },

    async notifyCheck(checkId) {
      const c = await check(checkId);
      if (c === null) return null;
      const s = await site(c.site_id);
      if (s === null) return null;
      return { status: c.status, notifyEmail: c.notify_email, host: s.host, accountId: s.account_id };
    },

    async fixEmailRequest(requestId) {
      const r = await sb
        .from('fix_email_requests')
        .select('to_email, sent_at, account_id, fix_id')
        .eq('id', requestId)
        .maybeSingle();
      if (r.error) fail('fix_email_requests', r.error);
      if (r.data === null) return null;
      const req = RequestRow.parse(r.data);
      const fix = await supabaseFixesStore(sb).fix(req.fix_id);
      if (fix === null) return null;
      const s = await site(fix.site_id);
      if (s === null) return null;
      return { toEmail: req.to_email, sentAt: req.sent_at, accountId: req.account_id, host: s.host, fix };
    },

    async markFixEmailSent(requestId, at) {
      const r = await sb
        .from('fix_email_requests')
        .update({ sent_at: at.toISOString() })
        .eq('id', requestId)
        .is('sent_at', null);
      if (r.error) fail('fix_email_requests update', r.error);
    },

    async finishedCheck(checkId) {
      const c = await check(checkId);
      if (c === null) return null;
      const s = await site(c.site_id);
      return { trigger: c.trigger, status: c.status, accountId: s?.account_id ?? null };
    },
  };
}
