/**
 * The entitlement machine's effects, carried out (CC-03 D5). Every caller of the machine dispatches
 * through here: the v2 Stripe webhook, our clock and the first-login trial.
 *
 * `planEffects` turns a transition's effects into what is sent. Each Inngest event's id is fixed by
 * its name, the account and the source of the change (a Stripe event id, or a key of our clock), so a
 * plan sent again within 24 hours delivers each event once: Inngest drops an id it saw in that window.
 * Sent again later (Stripe retries for three days), an event is delivered again, so whoever consumes
 * it must take a repeat. The webhook stores the plan with its decision and sends it again on a retry
 * (spec 03, "The webhook").
 *
 * The webhook adds `cancel` entries of its own (spec 03, "Stripe writes from the webhook"); the machine plans none.
 *
 * `relimit`, `pause_others`, `pause_over_limit` and `resume` plan nothing: since migration 003
 * `apply_entitlement_transition` applies them in the transaction that writes the state, so carrying
 * them out here would apply them twice (spec 03, "Effects").
 */
import { z } from 'zod';
import { AccountStateSchema } from '@crawlmouse/types/v2';
import type { Effect, EntitlementSnapshot } from './state-machine';

const SUBSCRIPTION_ID = /^sub_[A-Za-z0-9_]+$/;

export const PlannedEffectSchema = z.union([
  z.strictObject({
    kind: z.literal('send'),
    id: z.string().min(1),
    name: z.literal('trial.started'),
    data: z.strictObject({
      accountId: z.string().min(1),
      trialEndsAt: z.string().min(1),
      variant: z.enum(['no_card', 'card_required']),
    }),
  }),
  z.strictObject({
    kind: z.literal('send'),
    id: z.string().min(1),
    name: z.literal('trial.converted'),
    data: z.strictObject({ accountId: z.string().min(1) }),
  }),
  z.strictObject({
    kind: z.literal('send'),
    id: z.string().min(1),
    name: z.literal('entitlement.changed'),
    data: z.strictObject({
      accountId: z.string().min(1),
      from: AccountStateSchema,
      to: AccountStateSchema,
    }),
  }),
  z.strictObject({
    kind: z.literal('send'),
    id: z.string().min(1),
    name: z.literal('email.requested'),
    data: z.strictObject({
      accountId: z.string().min(1),
      template: z.literal('trial_reminder'),
    }),
  }),
  z.strictObject({
    kind: z.literal('alert'),
    reason: z.enum(['dispute', 'orphaned_subscription']),
    /** Null for an orphaned subscription whose checkout named no account we know. */
    accountId: z.string().min(1).nullable(),
    subscriptionId: z.string().regex(SUBSCRIPTION_ID).nullable(),
    source: z.string().min(1),
  }),
  /**
   * Cancel a Stripe subscription at once, without proration. Planned by the webhook, never by the
   * machine: for a subscription a checkout left the account not following (`orphaned`),
   * and for the followed one of a disputed account (`disputed`).
   */
  z.strictObject({
    kind: z.literal('cancel'),
    subscriptionId: z.string().regex(SUBSCRIPTION_ID),
    reason: z.enum(['orphaned', 'disputed']),
    source: z.string().min(1),
  }),
]);

export type PlannedEffect = z.infer<typeof PlannedEffectSchema>;
export type PlannedSend = Extract<PlannedEffect, { kind: 'send' }>;
export type PlannedAlert = Extract<PlannedEffect, { kind: 'alert' }>;
export type PlannedCancel = Extract<PlannedEffect, { kind: 'cancel' }>;

/** A stored plan, read back from `stripe_events.effects`: refused whole when any entry is malformed. */
export const PlannedEffectsSchema = z.array(PlannedEffectSchema);

export interface EffectContext {
  accountId: string;
  /** What caused the change: a Stripe event id, or a key of our clock such as `trial-expired:<end>`. */
  source: string;
  /** The snapshot the transition was decided on, and the one it produced. */
  before: EntitlementSnapshot;
  after: EntitlementSnapshot;
}

function planOne(effect: Effect, ctx: EffectContext): PlannedEffect | null {
  const { accountId, source } = ctx;
  switch (effect.kind) {
    case 'relimit':
    case 'pause_others':
    case 'pause_over_limit':
    case 'resume':
      return null;
    case 'email':
      return {
        kind: 'send',
        id: `email.requested:${effect.template}:${accountId}:${source}`,
        name: 'email.requested',
        data: { accountId, template: effect.template },
      };
    case 'founder_alert':
      return {
        kind: 'alert',
        reason: effect.reason,
        accountId,
        subscriptionId: ctx.after.subscriptionId,
        source,
      };
    case 'event': {
      const id = `${effect.name}:${accountId}:${source}`;
      switch (effect.name) {
        case 'trial.started': {
          const { trialEndsAt, trialVariant } = ctx.after;
          if (trialEndsAt === null || trialVariant === null) {
            throw new Error('trial.started from a snapshot with no trial');
          }
          return {
            kind: 'send',
            id,
            name: 'trial.started',
            data: { accountId, trialEndsAt: trialEndsAt.toISOString(), variant: trialVariant },
          };
        }
        case 'trial.converted':
          return { kind: 'send', id, name: 'trial.converted', data: { accountId } };
        case 'entitlement.changed':
          return {
            kind: 'send',
            id,
            name: 'entitlement.changed',
            data: { accountId, from: ctx.before.state, to: ctx.after.state },
          };
      }
    }
  }
  throw new Error(`unknown effect ${JSON.stringify(effect)}`);
}

/** What `effects` sends, in the machine's order; the four effects of the transaction plan nothing. */
export function planEffects(effects: readonly Effect[], ctx: EffectContext): PlannedEffect[] {
  return effects.map((e) => planOne(e, ctx)).filter((p): p is PlannedEffect => p !== null);
}

/** An Inngest event as sent: a planned send without its tag, each name with its own data. */
export type InngestSend = PlannedSend extends infer P
  ? P extends PlannedSend
    ? Omit<P, 'kind'>
    : never
  : never;

/** The send without its tag; the variant's name and data stay paired. */
function untagged(p: PlannedSend): InngestSend {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the tag is dropped, not read
  const { kind, ...event } = p;
  return event;
}

export interface EffectSinks {
  /** Sends Inngest events in one call. */
  send(events: readonly InngestSend[]): Promise<void>;
  /** Cancels a subscription at once; done when it has already ended. */
  cancel(cancel: PlannedCancel): Promise<void>;
  /**
   * Raises a founder alert (Sentry), resolving once Sentry's client has flushed it. A Sentry that
   * rate-limits can still drop it; the plan, alert included, stays in `stripe_events.effects`.
   */
  alert(alert: PlannedAlert): Promise<void>;
}

/**
 * Carries out a plan: every event in one send, then each cancellation, then each alert, each awaited.
 * Anything that fails throws, so the caller does not mark the plan done and sends it again. On a
 * repeat, an event is dropped by Inngest within 24 hours of its first send, a cancellation is skipped
 * once Stripe shows the subscription ended, and an alert is raised again.
 */
export async function dispatchPlanned(
  planned: readonly PlannedEffect[],
  sinks: EffectSinks,
): Promise<void> {
  const sends = planned.filter((p): p is PlannedSend => p.kind === 'send');
  if (sends.length > 0) {
    await sinks.send(sends.map(untagged));
  }
  for (const p of planned) if (p.kind === 'cancel') await sinks.cancel(p);
  for (const p of planned) if (p.kind === 'alert') await sinks.alert(p);
}
