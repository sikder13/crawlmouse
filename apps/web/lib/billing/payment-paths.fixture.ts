/**
 * The payment events each way an account comes to pay sends, as `paymentEvents` plans them, reduced
 * to the properties a count of paying subscriptions reads (`trial`, `via`). payment-events.test.ts
 * holds this list equal to what `paymentEvents` returns on each path; scripts/ops/posthog/spec.test.ts
 * counts `[cm] Paid` over it. So a change to what a path sends fails one of the two.
 */
export interface PathEvent {
  event: 'subscription_started' | 'trial_converted';
  properties: { trial?: boolean; via?: 'checkout' | 'subscription' };
}

export const PAYMENT_PATHS = {
  /** A direct purchase: a paid checkout from Free. */
  direct: [{ event: 'subscription_started', properties: { trial: false } }],
  /** A no-card Pro trial's paying checkout. */
  noCardTrialPays: [
    { event: 'subscription_started', properties: { trial: false } },
    { event: 'trial_converted', properties: { via: 'checkout' } },
  ],
  /** A card (Agency) trial starting: not yet paying. */
  cardTrialStarts: [{ event: 'subscription_started', properties: { trial: true } }],
  /** That card trial's subscription turning active. */
  cardTrialPays: [{ event: 'trial_converted', properties: { via: 'subscription' } }],
} as const satisfies Record<string, readonly PathEvent[]>;

/** How many paying subscriptions each path is: what `[cm] Paid` must count. */
export const PAID_ON_PATH: Record<keyof typeof PAYMENT_PATHS, number> = {
  direct: 1,
  noCardTrialPays: 1,
  cardTrialStarts: 0,
  cardTrialPays: 1,
};
