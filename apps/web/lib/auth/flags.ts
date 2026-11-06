import 'server-only';

/**
 * The account door's flags. Read per request on the server; a client component gets the value as a
 * prop from the page that rendered it. Both are on for the value `1` only, whitespace ignored, like
 * CRAWL_PAUSED.
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

/** V2_PIPELINE=1 (set by CC-20b) means a named first site's audit starts when the link is opened. */
export function pipelineEnabled(env: Env = process.env): boolean {
  return env.V2_PIPELINE?.trim() === '1';
}
