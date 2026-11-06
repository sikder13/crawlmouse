/**
 * What Sentry must never receive from the sign-in path (SECURITY-DESIGN §9.2): the link's token, in
 * a URL (`?token_hash=` on GET /login/verify, `?code=` for the PKCE fallback), and the return target
 * `post_login_next`, which for a Keep carries a check id that is a claim capability.
 *
 * The door's own cookies need nothing here: their names contain `auth`, which Sentry's header filter
 * already replaces with "[Filtered]" (__tests__/v2/account-door-sentry.test.ts runs that filter over
 * each name). `post_login_next` keeps v1's name, so it is dropped here.
 *
 * `scrubDoorSecrets` walks the event, replacing those query values wherever a string holds them and
 * deleting attributes and keys named after `post_login_next`, at any depth: spans, contexts, request.
 */

/** A `token_hash=` or `code=` parameter, at the start of a query string or after `?` or `&`. */
const SECRET_QUERY = /((?:^|[?&])(?:token_hash|code)=)[^&#\s"]*/g;
const DROPPED_KEY = /post_login_next/;

function scrub(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return value.replace(SECRET_QUERY, '$1[Filtered]');
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = scrub(value[i], seen);
    return value;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (DROPPED_KEY.test(key)) {
      delete record[key];
      continue;
    }
    record[key] = scrub(record[key], seen);
  }
  return value;
}

/** For `beforeSend` and `beforeSendTransaction`: the same event, with the door's secrets removed. */
export function scrubDoorSecrets<T>(event: T): T {
  return scrub(event, new WeakSet()) as T;
}
