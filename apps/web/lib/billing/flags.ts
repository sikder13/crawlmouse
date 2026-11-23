/**
 * The v2 billing flag (CC-03 D1), read here and nowhere else. On for the value `1` only, whitespace
 * ignored, like the account door's flags. Not a NEXT_PUBLIC_ variable, so a client bundle that
 * imported this would read undefined and see it off.
 *
 * V2_BILLING=1 serves the v2 checkout, agency trial, cancel and portal handlers, the
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
