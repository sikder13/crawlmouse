/**
 * The entitlement machine's effects, carried out (CC-03 D5). Every caller of the machine dispatches
 * through here: the v2 Stripe webhook, our clock and the first-login trial.
 *
 * `planEffects` turns a transition's effects into what is sent. Each Inngest event's id is fixed by
 * its name, the account and the source of the change (a Stripe event id, or a key of our clock), so a
 * plan sent twice delivers each event once: Inngest drops an event whose id it saw in the last 24
 * hours. The webhook stores the plan with its decision and sends it again on a retry (questions Q1).
 *
 * `relimit`, `pause_others`, `pause_over_limit` and `resume` plan nothing: since migration 003
 * `apply_entitlement_transition` applies them in the transaction that writes the state, so carrying
 * them out here would apply them twice (questions Q2).
 */
import { z } from 'zod';
import { AccountStateSchema } from '@crawlmouse/types/v2';
import type { Effect, EntitlementSnapshot } from './state-machine';

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
    reason: z.literal('dispute'),
    accountId: z.string().min(1),
    source: z.string().min(1),
  }),
]);

export type PlannedEffect = z.infer<typeof PlannedEffectSchema>;
export type PlannedSend = Extract<PlannedEffect, { kind: 'send' }>;
export type PlannedAlert = Extract<PlannedEffect, { kind: 'alert' }>;

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
      return { kind: 'alert', reason: effect.reason, accountId, source };
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

/** An Inngest event as sent: a planned send without its tag. */
export interface InngestSend {
  id: string;
  name: PlannedSend['name'];
  data: PlannedSend['data'];
}

export interface EffectSinks {
  /** Sends Inngest events in one call. */
  send(events: readonly InngestSend[]): Promise<void>;
  /** Raises a founder alert (Sentry). */
  alert(alert: PlannedAlert): void;
}

/** Sends every event of the plan in one call, then raises its alerts. A failed send throws. */
export async function dispatchPlanned(
  planned: readonly PlannedEffect[],
  sinks: EffectSinks,
): Promise<void> {
  const sends = planned.filter((p): p is PlannedSend => p.kind === 'send');
  if (sends.length > 0) {
    await sinks.send(sends.map(({ id, name, data }) => ({ id, name, data })));
  }
  for (const p of planned) if (p.kind === 'alert') sinks.alert(p);
}
