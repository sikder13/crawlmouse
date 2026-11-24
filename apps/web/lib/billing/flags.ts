/**
 * The v2 billing flag (CC-03 D1), read here and nowhere else. On for the value `1` only, whitespace
 * ignored, like the account door's flags. Not a NEXT_PUBLIC_ variable, so a client bundle that
 * imported this would read undefined and see it off.
 *
 * V2_BILLING=1 serves the v2 checkout, cancel and portal handlers (the Agency trial and an Agency
 * checkout also need `agencySalesOpen`), the
 * /api/webhooks/stripe-account endpoint, the trial and past-due functions and the reconcile's v2 mode,
 * and dispatches the first-login trial's effects. Unset, every v1 billing route answers as before and
 * the new routes are 404s.
 */

type Env = Readonly<Record<string, string | undefined>>;

export function billingV2Enabled(env: Env = process.env): boolean {
  return env.V2_BILLING?.trim() === '1';
}

/**
 * Whether Agency is on sale. While it is labelled "coming", V2_BILLING alone must not sell it: the
 * checkout refuses `plan: 'agency'`, and `/agency-trial` and its route answer 404. On for the value
 * `1` only, whitespace ignored.
 */
export function agencySalesOpen(env: Env = process.env): boolean {
  return env.V2_AGENCY_SALES?.trim() === '1';
}

/**
 * The one user paying is open to while it is kept to them, from `V2_BILLING_ONLY_USER` (a user id,
 * whitespace ignored); null when unset or empty. Production sets it for the owner's own purchase and
 * refund when billing is switched on, and unsets it once that has passed (specs/billing-switch-on).
 */
export function billingOnlyUser(env: Env = process.env): string | null {
  const only = env.V2_BILLING_ONLY_USER?.trim();
  return only ? only : null;
}

/**
 * Whether `userId` may start paying: billing is on, and paying is not kept to another user. The
 * checkout and the seats route read this; the webhook, cancel and the portal read
 * `billingV2Enabled` alone, so the owner's own subscription is handled in full.
 */
export function billingOpenTo(userId: string | null, env: Env = process.env): boolean {
  if (!billingV2Enabled(env)) return false;
  const only = billingOnlyUser(env);
  return only === null || only === userId;
}

/** Whether pages may show paying as open to every visitor: billing is on and kept to no one. */
export function billingPublic(env: Env = process.env): boolean {
  return billingV2Enabled(env) && billingOnlyUser(env) === null;
}
