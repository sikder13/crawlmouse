/**
 * The v2 Stripe webhook's handler (CC-03 D2, D4, D5; spec 03, "The webhook"). The route
 * (app/api/webhooks/stripe-account/route.ts) verifies the signature and calls this; the sandbox
 * smoke calls it against PGlite.
 *
 * 1. An event of the other mode is refused, its ledger row left undecided, so a retry after the
 *    mode is set right is processed.
 * 2. The ledger row: a processed event does nothing; a decided one whose effects were not confirmed
 *    sends them again.
 * 3. Normalise (./stripe-normalise.ts), then decide through the machine or record, in one
 *    `apply_stripe_event` call that also stores the planned effects. A decision made on an account
 *    that changed meanwhile, or a customer binding that lost a race, is normalised and decided again,
 *    at most three more times.
 * 4. Send the effects the call recorded (the stored plan, not the one it was asked to store), then
 *    stamp `processed_at`.
 *
 * A failure anywhere throws, so the route answers 500 and Stripe retries.
 */
import type Stripe from 'stripe';
import { dispatchPlanned, planEffects, type PlannedEffect } from './effects';
import type { EntitlementSnapshot, Transition } from './state-machine';
import { applyEntitlementTransition, EntitlementConflictError } from './state-machine-apply';
import { normalise, orphanEffects, type Decision, type Report } from './stripe-normalise';
import {
  BindingConflictError,
  eventStore,
  recordDecision,
  type RecordedDecision,
  type WebhookDb,
} from './webhook-db';
import type { StripeReads, WebhookDeps, WebhookOutcome } from './webhook-types';

/** Re-decisions after a conflict, beyond the first. */
export const MAX_RERUNS = 3;

export interface WebhookReport extends Report {
  eventId: string;
  type: string;
  accountId: string | null;
}

export interface WebhookOptions {
  /** The clock the one-hour retry for an unknown customer is measured on. */
  now?: () => Date;
  /** Where operator reports go; the route sends them to Sentry. */
  report?: (report: WebhookReport) => void;
}

function logReport(r: WebhookReport): void {
  console.warn(`[stripe-account-webhook] ${r.message} for ${r.type} ${r.eventId}`);
}

/** The Stripe reads the handler makes, over a client of the Crawlmouse account. */
export function stripeReads(stripe: Stripe): StripeReads {
  return {
    retrieveSubscription: (id) => stripe.subscriptions.retrieve(id),
    retrieveCharge: (id) => stripe.charges.retrieve(id),
  };
}

/**
 * The effects of an applied or ignored transition: the machine's, a cancellation of a disputed
 * account's subscription (spec 03, Q13), and for a checkout the orphan rules (Q10): its own
 * subscription when its grant was ignored for any reason but already being the current one, the
 * subscription it replaced when it applied.
 */
async function planFor(
  d: Extract<Decision, { kind: 'apply' }>,
  before: EntitlementSnapshot,
  transition: Transition,
  stripe: StripeReads,
): Promise<PlannedEffect[]> {
  const source = d.write.eventId;
  const planned = planEffects(transition.effects, {
    accountId: d.accountId,
    source,
    before,
    after: transition.state,
  });
  const followed = transition.state.subscriptionId;
  if (d.event.type === 'dispute_created' && followed !== null) {
    planned.push({ kind: 'cancel', subscriptionId: followed, reason: 'disputed', source });
  }
  if (d.checkout !== null) {
    if (transition.outcome === 'ignored') {
      if (transition.reason !== 'already the current subscription') {
        planned.push(...orphanEffects(d.checkout, d.accountId, source));
      }
    } else if (before.subscriptionId !== null && before.subscriptionId !== followed) {
      const replaced = await stripe.retrieveSubscription(before.subscriptionId);
      planned.push(
        ...orphanEffects(
          { subscriptionId: replaced.id, status: replaced.status },
          d.accountId,
          source,
        ),
      );
    }
  }
  return planned;
}

interface Decided {
  decision: Decision;
  recorded: RecordedDecision;
  /** Whether the call recorded what the machine decided, rather than the out-of-order guard's no. */
  asMachine: boolean;
}

async function decideOnce<Db extends WebhookDb>(
  event: Stripe.Event,
  deps: WebhookDeps<Db>,
  now: Date,
): Promise<Decided> {
  const decision = await normalise(event, {
    db: deps.db,
    stripe: deps.stripe,
    catalog: deps.catalog,
    now,
  });
  if (decision.kind === 'record') {
    const recorded = await recordDecision(
      deps.db,
      decision.write,
      decision.reason,
      decision.effects,
    );
    return { decision, recorded, asMachine: false };
  }
  const store = eventStore(deps.db, decision.write, (before, transition) =>
    planFor(decision, before, transition, deps.stripe),
  );
  const { transition } = await applyEntitlementTransition(
    store,
    decision.accountId,
    decision.event,
  );
  const recorded = store.recorded();
  if (recorded === null) throw new Error('the webhook store recorded no decision');
  const reason = transition.outcome === 'ignored' ? transition.reason : null;
  return {
    decision,
    recorded,
    asMachine:
      recorded.handled === (transition.outcome === 'applied') && recorded.reason === reason,
  };
}

async function decide<Db extends WebhookDb>(
  event: Stripe.Event,
  deps: WebhookDeps<Db>,
  now: () => Date,
): Promise<Decided> {
  for (let rerun = 0; ; rerun++) {
    try {
      return await decideOnce(event, deps, now());
    } catch (err) {
      const conflict =
        err instanceof EntitlementConflictError || err instanceof BindingConflictError;
      if (!conflict || rerun >= MAX_RERUNS) throw err;
    }
  }
}

async function finish<Db extends WebhookDb>(
  deps: WebhookDeps<Db>,
  eventId: string,
  effects: readonly PlannedEffect[],
): Promise<void> {
  await dispatchPlanned(effects, deps.sinks);
  await deps.db.stamp(eventId);
}

export async function applyStripeEvent<Db extends WebhookDb>(
  event: Stripe.Event,
  deps: WebhookDeps<Db>,
  options: WebhookOptions = {},
): Promise<WebhookOutcome> {
  const now = options.now ?? (() => new Date());
  const report = options.report ?? logReport;
  const ledger = { id: event.id, type: event.type, livemode: event.livemode };

  if (event.livemode !== deps.livemode) {
    await deps.db.recordRefused(ledger, 'livemode_mismatch');
    return { outcome: 'refused', reason: 'livemode_mismatch' };
  }

  const state = await deps.db.begin(ledger);
  if (state.kind === 'processed') return { outcome: 'duplicate' };
  if (state.kind === 'decided') {
    await finish(deps, event.id, state.effects);
    return { outcome: 'resumed' };
  }

  const { decision, recorded, asMachine } = await decide(event, deps, now);
  if (recorded.decidedBefore) {
    await finish(deps, event.id, recorded.effects);
    return { outcome: 'resumed' };
  }
  for (const r of decision.reports) {
    report({ ...r, eventId: event.id, type: event.type, accountId: decision.accountId });
  }
  await finish(deps, event.id, recorded.effects);
  return {
    outcome: recorded.handled ? 'applied' : asMachine ? 'ignored' : 'recorded',
    accountId: decision.accountId,
    reason: recorded.reason,
  };
}
