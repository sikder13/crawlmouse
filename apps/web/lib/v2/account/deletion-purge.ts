/**
 * The steps of the deletion's Inngest functions (inngest/deletion.ts), over ports: ending and resuming
 * a deleted account's subscription, and the purge of one person whose window has ended.
 *
 * The purge of one person (D4 d): ban the Auth user again (the confirm's ban may have failed), end any
 * subscription still live at once (no proration, no refund: owner question Q7), then the one erasure
 * (`erasePerson`) with `p_require_due`, so its apply runs only past the window and under the queue
 * row's lock; then the queue row goes (`finish_erasure`, which refuses while the Auth user exists) and
 * `account_purged` is sent with the counts. A refusal counts the attempt and is reported with the user
 * id only, except on a run that has just ended a subscription: the erasure refuses until Stripe's
 * webhook has written that, so the next day's run is the one to look at.
 */
import type Stripe from 'stripe';
import { cancelSubscription, type CancelDeps } from '../../billing/cancel';
import type {
  DeletionBilling,
  DuePerson,
  Purge,
  PurgeOutcome,
} from '../../../../../inngest/deletion';
import type { CaptureAccountEvent } from './account-events';
import type { Rpc } from './deletion';
import { erasePerson, type ErasurePorts } from './erase';

/** Statuses CC-03's cancel ends at the period's end, which a restore can therefore continue. */
const RESUMABLE: ReadonlySet<string> = new Set(['active', 'trialing']);

export interface BillingPorts {
  rpc: Rpc;
  cancel: CancelDeps;
}

export function deletionBilling(ports: BillingPorts): DeletionBilling {
  const stripe = ports.cancel.stripe.subscriptions;
  return {
    async cancel(userId, accountId) {
      const followed = await ports.cancel.accounts.followed(accountId);
      if (followed === null) return 'no_subscription';
      const sub = await stripe.retrieve(followed.id);
      // Only a plan a restore can continue is ended at confirm (set to end at its period's end). A
      // past-due, unpaid or paused one CC-03 would cancel at once; it is left to the purge's at-once
      // cancel, so a restore never finds a plan this deletion killed.
      if (!RESUMABLE.has(sub.status)) return `left:${sub.status}`;
      const weSetCancel = !sub.cancel_at_period_end;
      const recorded = await ports.rpc<boolean>('record_deletion_cancel', {
        p_user: userId,
        p_account: accountId,
        p_subscription: followed.id,
        p_we_set_cancel: weSetCancel,
      });
      if (!recorded) return 'restored';
      const r = await cancelSubscription(ports.cancel, { accountId, confirmed: true });
      if (r.ok) return 'cancelled';
      if (r.error === 'no_subscription') return 'no_subscription';
      throw new Error(`deletion cancel of ${followed.id}: ${r.error}`);
    },
    async resume(subscriptionId) {
      const sub = await stripe.retrieve(subscriptionId);
      if (!RESUMABLE.has(sub.status) || !sub.cancel_at_period_end) return `left:${sub.status}`;
      await stripe.update(subscriptionId, { cancel_at_period_end: false });
      return 'resumed';
    },
  };
}

export interface PurgePorts {
  rpc: Rpc;
  auth: {
    /** Whether the Auth user is still there. */
    exists(userId: string): Promise<boolean>;
    ban(userId: string): Promise<void>;
  };
  /** The live subscriptions of these accounts, by id. */
  liveSubscriptions(accounts: readonly string[]): Promise<string[]>;
  stripe: {
    cancel(
      id: string,
      params: Stripe.SubscriptionCancelParams,
      options: { idempotencyKey: string },
    ): PromiseLike<unknown>;
  };
  /** The erasure's ports, whose apply passes `p_require_due`. */
  erasure: ErasurePorts;
  capture: CaptureAccountEvent;
  /** Sentry: what failed, and the user id, nothing else. */
  report(what: string, userId: string): void;
  now(): number;
}

export function purge(ports: PurgePorts): Purge {
  return {
    now: ports.now,
    async due(at, limit) {
      const rows = await ports.rpc<Array<{ user_id: string; accounts: string[] }>>('due_erasures', {
        p_now: at.toISOString(),
        p_limit: limit,
      });
      return rows.map((r) => ({ userId: r.user_id, accounts: r.accounts }));
    },
    purgeOne: (person) => purgeOne(ports, person),
    async failed(userId, why) {
      await ports.rpc('record_erasure_attempt', { p_user: userId });
      console.error(`[purge] ${userId}: ${why}`);
      ports.report('account.purge_failed', userId);
    },
  };
}

async function purgeOne(ports: PurgePorts, person: DuePerson): Promise<PurgeOutcome> {
  const { userId, accounts } = person;
  // An Auth user already gone (an earlier run, or a delete outside the erasure) cannot be banned;
  // the erasure still runs, by the queue row (erase_person_plan), and its Auth delete answers 404.
  if (await ports.auth.exists(userId)) await ports.auth.ban(userId);
  const live = await ports.liveSubscriptions(accounts);
  for (const id of live) {
    await ports.stripe.cancel(id, { prorate: false }, { idempotencyKey: `purge:${id}` });
  }

  const result = await erasePerson(marked(ports.erasure, accounts), { userId });
  if (!result.ok) {
    await ports.rpc('record_erasure_attempt', { p_user: userId });
    if (live.length === 0) ports.report('account.purge_refused', userId);
    return { outcome: 'refused', refusals: result.refusals };
  }
  await ports.rpc('finish_erasure', { p_user: userId });
  await ports.capture('account_purged', accounts[0]!, { counts: result.before.counts });
  return { outcome: 'purged', counts: result.before.counts };
}

/**
 * The erasure's ports with one more refusal: every account the plan would delete must be one the
 * confirm marked (`pending_erasures.accounts`), so the purge never erases an account it was not asked
 * to (S5). A marked account missing from the plan is one an earlier run already deleted (after which
 * the Auth delete failed), so the rule is "a subset", not "the same set". The refusal goes first,
 * ahead of the plan's own; the Storage refusal stays last.
 */
function marked(erasure: ErasurePorts, accounts: readonly string[]): ErasurePorts {
  return {
    ...erasure,
    async plan(target) {
      const plan = await erasure.plan(target);
      if (plan.accounts.every((a) => accounts.includes(a))) return plan;
      return {
        ...plan,
        refusals: [
          `the accounts to erase (${plan.accounts.join(', ')}) are not the accounts the confirm marked (${accounts.join(', ')})`,
          ...plan.refusals,
        ],
      };
    },
  };
}
