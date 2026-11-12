/**
 * The deletion's ports as production wires them: the service-role client (RPC, Auth admin, Storage),
 * Inngest, the rate limiter, Sentry and the product events. Routes build `routeDeletionPorts` after
 * they have checked the caller; the Inngest serve route registers `deletionFunctions`.
 */
import * as Sentry from '@sentry/nextjs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { InngestFunction } from 'inngest';
import { inngest } from '../../../../../inngest/client';
import {
  createDeletionCancelFn,
  createDeletionResumeFn,
  createPurgeDeletedAccountsFn,
} from '../../../../../inngest/deletion';
import { supabaseCancelAccounts, type CancelStripe } from '../../billing/cancel';
import { stripeAccount } from '../../billing/stripe-account';
import { checkRateLimit } from '../../rate-limit';
import { accountCapture, type CaptureAccountEvent } from './account-events';
import type { DeletionPorts, Rpc } from './deletion';
import { deletionBilling, purge, type PurgePorts } from './deletion-purge';
import type { ErasurePlan, ErasurePorts, StorageObject } from './erase';

type Env = Readonly<Record<string, string | undefined>>;

/** A ban that does not end: Supabase Auth takes a duration, and a deletion is lifted only by a restore. */
const BAN_DURATION = '876000h';
const DAY_MS = 86_400_000;
/** The Storage API's remove takes a list; this many names per call. */
const REMOVE_BATCH = 100;

export function serviceRpc(sb: SupabaseClient): Rpc {
  return async <T>(fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(`${fn} failed: ${error.message}`);
    return data as T;
  };
}

function authAdmin(sb: SupabaseClient) {
  const ban = async (userId: string, duration: string) => {
    const { error } = await sb.auth.admin.updateUserById(userId, { ban_duration: duration });
    if (error) throw new Error(`Auth ban (${duration}) failed: ${error.message}`);
  };
  return {
    ban: (userId: string) => ban(userId, BAN_DURATION),
    unban: (userId: string) => ban(userId, 'none'),
    async exists(userId: string) {
      const { data, error } = await sb.auth.admin.getUserById(userId);
      if (error?.status === 404) return false;
      if (error) throw new Error(`Auth read failed: ${error.message}`);
      return data.user !== null;
    },
    async deleteUser(userId: string) {
      const { error } = await sb.auth.admin.deleteUser(userId);
      if (error && error.status !== 404) throw new Error(`Auth delete failed: ${error.message}`);
    },
  };
}

/** The erasure over the service-role client; `requireDue` is the purge's, so its apply waits for the window. */
export function serviceErasurePorts(sb: SupabaseClient, requireDue: boolean): ErasurePorts {
  const rpc = serviceRpc(sb);
  return {
    plan: (target) =>
      rpc<ErasurePlan>('erase_person_plan', {
        p_user: target.userId ?? null,
        p_email: target.email ?? null,
      }),
    async apply(target, expected) {
      await rpc('erase_person_apply', {
        p_user: target.userId ?? null,
        p_email: target.email ?? null,
        p_expected: expected,
        p_require_due: requireDue,
      });
    },
    async removeStorage(objects: readonly StorageObject[]) {
      const byBucket = new Map<string, string[]>();
      for (const o of objects) byBucket.set(o.bucket, [...(byBucket.get(o.bucket) ?? []), o.name]);
      for (const [bucket, names] of byBucket) {
        for (let i = 0; i < names.length; i += REMOVE_BATCH) {
          const { error } = await sb.storage.from(bucket).remove(names.slice(i, i + REMOVE_BATCH));
          if (error) throw new Error(`Storage remove in ${bucket} failed: ${error.message}`);
        }
      }
    },
    deleteAuthUser: (userId) => authAdmin(sb).deleteUser(userId),
    async sweepAuditLog(plan) {
      await rpc('erase_auth_audit_log', { p_user: plan.userId, p_emails: plan.emails });
    },
    async recount(plan) {
      const after = await rpc<{ counts: Record<string, number>; storage: StorageObject[] }>(
        'erase_person_counts',
        { p_user: plan.userId, p_emails: plan.emails, p_accounts: plan.accounts },
      );
      return { counts: after.counts, storage: after.storage };
    },
  };
}

/** Reports to Sentry with the user id and nothing else of the person's. */
function report(what: unknown, userId: string): void {
  if (typeof what === 'string')
    Sentry.captureMessage(what, { level: 'error', user: { id: userId } });
  else Sentry.captureException(what, { user: { id: userId } });
}

/** A route's ports, for the request whose `Cookie` header decides whether its event is counted. */
export function routeDeletionPorts(sb: SupabaseClient, cookieHeader: string | null): DeletionPorts {
  return {
    rpc: serviceRpc(sb),
    auth: authAdmin(sb),
    send: async (events) => {
      await inngest.send([...events]);
    },
    sendEmails: async (events) => {
      await inngest.send([...events]);
    },
    capture: accountCapture(cookieHeader),
    rateLimit: async (bucket, limit) =>
      (await checkRateLimit(bucket, limit, DAY_MS, { failClosed: true })).allowed,
    report,
    now: () => new Date(),
  };
}

const serviceClient = (env: Env): SupabaseClient =>
  createClient(env.NEXT_PUBLIC_SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', {
    auth: { persistSession: false },
  });

/**
 * The v2 Stripe client's subscription calls, made on first use: a person with no subscription is
 * purged with no Stripe key needed.
 */
const lazyStripe = (env: Env): CancelStripe => ({
  subscriptions: {
    retrieve: (id) => stripeAccount(env).subscriptions.retrieve(id),
    update: (id, params) => stripeAccount(env).subscriptions.update(id, params),
    cancel: (id, params, options) => stripeAccount(env).subscriptions.cancel(id, params, options),
  },
});

/** The purge's ports over the service-role client and the v2 Stripe client's subscription calls. */
export function purgePorts(
  sb: SupabaseClient,
  stripe: CancelStripe['subscriptions'],
  capture: CaptureAccountEvent = accountCapture(null),
): PurgePorts {
  return {
    rpc: serviceRpc(sb),
    auth: authAdmin(sb),
    async liveSubscriptions(accounts) {
      const { data, error } = await sb
        .from('subscriptions')
        .select('id')
        .in('account_id', [...accounts])
        .not('status', 'in', '("canceled","incomplete_expired")');
      if (error) throw new Error(`subscriptions read failed: ${error.message}`);
      return (data as { id: string }[]).map((r) => r.id);
    },
    stripe,
    erasure: serviceErasurePorts(sb, true),
    capture,
    report,
    now: Date.now,
  };
}

/** The deletion's three Inngest functions, their clients built when a step runs. */
export function deletionFunctions(env: Env = process.env): InngestFunction.Like[] {
  const billing = () => {
    const sb = serviceClient(env);
    return deletionBilling({
      rpc: serviceRpc(sb),
      cancel: {
        accounts: supabaseCancelAccounts(sb),
        stripe: lazyStripe(env),
        now: () => new Date(),
      },
    });
  };
  // The purge has no request, so its event goes with no cookie header: no person profile.
  const purgeSteps = () => purge(purgePorts(serviceClient(env), lazyStripe(env).subscriptions));
  return [
    createDeletionCancelFn(billing),
    createDeletionResumeFn(billing),
    createPurgeDeletedAccountsFn(purgeSteps),
  ];
}
