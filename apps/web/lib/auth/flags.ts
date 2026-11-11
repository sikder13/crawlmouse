/**
 * The v2 flags. Read per request on the server; a client component gets the value as a prop from
 * the page that rendered it. Each is on for the value `1` only, whitespace ignored, like
 * CRAWL_PAUSED. None is a NEXT_PUBLIC_ variable, so a client bundle that imported this would read
 * undefined and see every flag off.
 */

type Env = Readonly<Record<string, string | undefined>>;

/**
 * V2_ACCOUNT_DOOR=1 serves /signup, /check-email and POST /api/checks/[id]/claim, lets the
 * magic-link route read the v2 fields, and runs the first-login hook. Unset, those routes are 404s
 * and sign-in does exactly what it did before. The sign-in landing's GET/POST split is on for everyone.
 */
export function accountDoorEnabled(env: Env = process.env): boolean {
  return env.V2_ACCOUNT_DOOR?.trim() === '1';
}

/**
 * V2_PIPELINE=1 registers the check pipeline's Inngest functions (CC-20b). It changes nothing a
 * visitor reads: what the pages promise about checks is V2_CHECKS_PUBLIC.
 */
export function pipelineEnabled(env: Env = process.env): boolean {
  return env.V2_PIPELINE?.trim() === '1';
}

/**
 * V2_CHECKS_PUBLIC=1 lets Sign-up and Check-email say that a named first site's audit starts when the
 * link is opened, that a kept site is re-checked, and that change notes come from alerts@. Those
 * sentences are true only once requestCheck is called from the claim route and Sign-up, checks are
 * scheduled, and CC-28 sends from alerts@; the flag stays off until then.
 * It also gives the claim its one-transaction commit with the evidence move, and, with V2_PIPELINE=1,
 * gives the claim and the first-login hook the first-audit request (door-deps.ts, CC-22b D7).
 */
export function checksPublicEnabled(env: Env = process.env): boolean {
  return env.V2_CHECKS_PUBLIC?.trim() === '1';
}
