/**
 * What Sentry must never receive from the sign-in path (SECURITY-DESIGN §9.2): the link's token, a
 * Keep's claim target (`post_login_next`, whose check id is a claim capability), the ledger's device
 * signal, and the session.
 *
 * Three layers, each tested in __tests__/v2/account-door-sentry.test.ts, the last two through the
 * SDK's own event pipeline:
 * - spans: the door's cookie names contain `auth`, which Sentry's span-header filter replaces with
 *   "[Filtered]";
 * - events: `sentryServerOptions` turns off the request-data integration's cookies, which removes
 *   both `request.cookies` and the raw `Cookie` header from every event;
 * - `scrubDoorSecrets`, run on every event and transaction: drops any `cookie`, `cookies`,
 *   `set-cookie` or `post_login_next` key at any depth, and replaces a `token_hash` or `code` query
 *   value, URL-encoded or not, and a `post_login_next=` value, wherever a string holds one.
 */

/**
 * A `token_hash` or `code` parameter, after the start of a string, `?`, `&` or `;`, or their
 * URL-encoded forms; its value runs to the next delimiter, an encoded `&` included.
 */
const SECRET_QUERY =
  /((?:^|[?&;]|%3F|%26)(?:token_hash|code)(?:=|%3D))[^&#;\s"%]*(?:%(?!26)[0-9a-f]{2}[^&#;\s"%]*)*/gi;
const DROPPED_KEY = /^(?:cookies?|set-cookie)$|post_login_next/i;
/** A `post_login_next=` pair inside a string (a cookie header, a log line): its value goes. */
const NEXT_IN_STRING = /(post_login_next=)[^;&\s"]*/gi;

function scrub(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return value.replace(SECRET_QUERY, '$1[Filtered]').replace(NEXT_IN_STRING, '$1[Filtered]');
  }
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

/**
 * The server SDK's options that keep those secrets out, for `Sentry.init` in sentry.server.config.ts
 * and for the test that drives the SDK with them. `requestDataIntegration` is passed in so this
 * module does not load the SDK.
 */
export function sentryServerOptions<I>(
  requestDataIntegration: (options: { include: { cookies: false } }) => I,
) {
  return {
    integrations: [requestDataIntegration({ include: { cookies: false } })],
    beforeSend: <E>(event: E) => scrubDoorSecrets(event),
    beforeSendTransaction: <E>(event: E) => scrubDoorSecrets(event),
  };
}
